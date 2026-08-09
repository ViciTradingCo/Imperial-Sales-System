/**
 * Messages of the Day.
 *
 *  • Global MOTDs — notices shown to everyone on Home. A LIST, not one string:
 *    an admin can run several at once, schedule each, edit one without
 *    retyping it, and see what is currently out there. It used to be a single
 *    value that could only be overwritten or cleared, which meant the only
 *    record of what had been announced was whoever remembered posting it.
 *  • Individual MOTDs — per-business notices with an optional start/end window;
 *    shown on that business's Home while active.
 *  • Expiry warning — an automatic banner for a business's owner/employees when
 *    its certification is near (or past) expiry; the lead time is configurable.
 *
 * Storage in D1 — all PER REALM:
 *  • motd_list: id | realm_id | business | message | start_at | end_at. A row
 *    with an EMPTY business is a global notice — same table, same scheduling,
 *    one mechanism rather than two that drift apart.
 *  • sys_flags: 'motd_warn_days:<realm>' = lead days. sys_flags has no realm_id
 *    column, so the realm is part of the key instead. 'motd_global:<realm>' is
 *    the retired single-value global notice, migrated on first read.
 */
import { getDb, getFlag, setFlag, DEFAULT_REALM_ID } from './db.js';

// How many days before expiry the certification banner starts warning.
// Admins can change it per realm (MOTD → Expiry warning).
const DEFAULT_WARN_DAYS = 3;

/** sys_flags key for a per-realm value. */
function rk(base, realmId) {
  return base + ':' + String(realmId || DEFAULT_REALM_ID);
}


/* ---- expiry-warning lead days (per realm) ---- */
export async function readWarnDays(env, realmId) {
  const raw = await getFlag(env, rk('motd_warn_days', realmId));
  const n = raw != null ? Number(raw) : NaN;
  return isFinite(n) && n >= 0 ? Math.round(n) : DEFAULT_WARN_DAYS;
}
export async function writeWarnDays(env, days, realmId) {
  let n = Math.round(Number(days));
  if (!isFinite(n) || n < 0) n = DEFAULT_WARN_DAYS;
  await setFlag(env, rk('motd_warn_days', realmId), String(n));
  return n;
}

function genId() {
  return 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

function rowToMotd(r) {
  return {
    id: String(r.id || '').trim(),
    business: String(r.business || '').trim(),
    message: String(r.message || '').trim(),
    start: String(r.start_at || '').trim(),
    end: String(r.end_at || '').trim(),
  };
}

/** Whether a notice's schedule says it should be showing right now. */
function showing(m, now) {
  if (m.start) { const s = Date.parse(m.start); if (isFinite(s) && now < s) return false; }
  if (m.end) { const e = Date.parse(m.end); if (isFinite(e) && now > e) return false; }
  return true;
}

/* ---- global notices (business = '') ----
 *
 * An EMPTY business means everyone. It reuses motd_list rather than getting a
 * table of its own so that scheduling, editing and deleting are the same code
 * for both kinds — the previous split (one flag string, one table) is exactly
 * why the global notice never gained a schedule or an edit.
 */

/**
 * The global rows, newest first, migrating the retired single-value notice the
 * first time it is asked for.
 *
 * Done on READ because the flag is per realm and there is no list of realms to
 * walk at deploy time. It is guarded on there being no global rows yet, so it
 * runs at most once per realm and cannot resurrect a notice an admin has since
 * deleted.
 */
async function globalRows(env, realmId) {
  const db = await getDb(env);
  const read = async () => {
    // ORDER BY rowid, not id. The id carries a timestamp but ends in four
    // random characters, so two notices posted in the same millisecond sort
    // arbitrarily — rowid IS insertion order, which is what "newest first"
    // means here.
    const { results } = await db.prepare(
      "SELECT * FROM motd_list WHERE realm_id = ? AND (business IS NULL OR business = '') ORDER BY rowid DESC")
      .bind(realmId).all();
    return (results || []).map(rowToMotd);
  };
  const rows = await read();
  if (rows.length) return rows;
  const legacy = String((await getFlag(env, rk('motd_global', realmId))) || '').trim();
  if (!legacy) return rows;
  await db.prepare("INSERT INTO motd_list (id, realm_id, business, message, start_at, end_at) VALUES (?, ?, '', ?, '', '')")
    .bind(genId(), realmId, legacy).run();
  await setFlag(env, rk('motd_global', realmId), '');
  return read();
}

export async function listGlobalMotds(env, realmId) {
  return globalRows(env, realmId);
}

export async function addGlobalMotd(env, { message, start, end }, realmId) {
  const msg = String(message || '').trim();
  if (!msg) throw new Error('Enter a message.');
  const db = await getDb(env);
  await db.prepare("INSERT INTO motd_list (id, realm_id, business, message, start_at, end_at) VALUES (?, ?, '', ?, ?, ?)")
    .bind(genId(), realmId, msg, String(start || '').trim(), String(end || '').trim()).run();
  return globalRows(env, realmId);
}

export async function updateGlobalMotd(env, { id, message, start, end }, realmId) {
  const msg = String(message || '').trim();
  if (!msg) throw new Error('Enter a message.');
  const db = await getDb(env);
  // The business check is what stops this editing a per-shop notice through
  // the global endpoint — an id alone would.
  const row = await db.prepare(
    "SELECT id FROM motd_list WHERE id = ? AND realm_id = ? AND (business IS NULL OR business = '')")
    .bind(String(id || '').trim(), realmId).first();
  if (!row) throw new Error('Entry not found.');
  await db.prepare('UPDATE motd_list SET message = ?, start_at = ?, end_at = ? WHERE id = ?')
    .bind(msg, String(start || '').trim(), String(end || '').trim(), row.id).run();
  return globalRows(env, realmId);
}

export async function deleteGlobalMotd(env, id, realmId) {
  const db = await getDb(env);
  const row = await db.prepare(
    "SELECT id FROM motd_list WHERE id = ? AND realm_id = ? AND (business IS NULL OR business = '')")
    .bind(String(id || '').trim(), realmId).first();
  if (!row) throw new Error('Entry not found.');
  await db.prepare('DELETE FROM motd_list WHERE id = ?').bind(row.id).run();
  return globalRows(env, realmId);
}

/** The global notices showing right now, in the order they were posted. */
export async function activeGlobalNotices(env, realmId) {
  const now = Date.now();
  return (await globalRows(env, realmId)).filter((m) => showing(m, now)).map((m) => m.message);
}

/* ---- individual (per-business) messages ---- */

/**
 * Every per-business notice in the realm. Global rows are EXCLUDED: they live
 * in the same table but they are not anybody's individual message, and listing
 * them here would offer them for editing under a business dropdown that has no
 * value to show.
 */
export async function listIndividualMotds(env, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    "SELECT * FROM motd_list WHERE realm_id = ? AND business IS NOT NULL AND business != '' ORDER BY business")
    .bind(realmId).all();
  return (results || []).map(rowToMotd);
}

export async function addIndividualMotd(env, { business, message, start, end }, realmId) {
  const biz = String(business || '').trim();
  const msg = String(message || '').trim();
  if (!biz) throw new Error('Pick a business.');
  if (!msg) throw new Error('Enter a message.');
  const db = await getDb(env);
  await db.prepare('INSERT INTO motd_list (id, realm_id, business, message, start_at, end_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(genId(), realmId, biz, msg, String(start || '').trim(), String(end || '').trim()).run();
  return listIndividualMotds(env, realmId);
}

/**
 * Finds a per-business row, refusing a global one.
 *
 * The two kinds share a table, so an id ALONE would let either endpoint reach
 * the other's rows. Both ends are behind requireAdmin, so this is not a
 * privilege boundary — it is about a delete landing where the caller can see
 * it, rather than a notice quietly vanishing from a list nobody was looking at.
 */
async function individualRow(db, id, realmId) {
  const row = await db.prepare(
    "SELECT id FROM motd_list WHERE id = ? AND realm_id = ? AND business IS NOT NULL AND business != ''")
    .bind(String(id || '').trim(), realmId).first();
  if (!row) throw new Error('Entry not found.');
  return row;
}

export async function updateIndividualMotd(env, { id, business, message, start, end }, realmId) {
  const biz = String(business || '').trim();
  // Without this an edit could blank the business and silently promote a shop's
  // notice into one everybody sees.
  if (!biz) throw new Error('Pick a business.');
  const db = await getDb(env);
  const row = await individualRow(db, id, realmId);
  await db.prepare('UPDATE motd_list SET business = ?, message = ?, start_at = ?, end_at = ? WHERE id = ?')
    .bind(biz, String(message || '').trim(), String(start || '').trim(), String(end || '').trim(), row.id).run();
  return listIndividualMotds(env, realmId);
}

export async function deleteIndividualMotd(env, id, realmId) {
  const db = await getDb(env);
  const row = await individualRow(db, id, realmId);
  await db.prepare('DELETE FROM motd_list WHERE id = ?').bind(row.id).run();
  return listIndividualMotds(env, realmId);
}

/* ---- owner-scoped notices (a shop's own board, for its staff) ----
 * Same motd_list table; these helpers are hard-scoped to ONE business so an
 * owner can post to their own staff without touching anyone else's notices.
 */
export async function listMotdsForBusiness(env, business, realmId) {
  const target = String(business || '').trim().toLowerCase();
  if (!target) return [];
  const db = await getDb(env);
  const { results } = await db.prepare('SELECT * FROM motd_list WHERE realm_id = ? AND lower(business) = ? ORDER BY rowid DESC').bind(realmId, target).all();
  return (results || []).map(rowToMotd);
}

export async function addMotdForBusiness(env, business, { message, start, end }, realmId) {
  const biz = String(business || '').trim();
  const msg = String(message || '').trim();
  if (!biz) throw new Error('No business.');
  if (!msg) throw new Error('Enter a message.');
  const db = await getDb(env);
  await db.prepare('INSERT INTO motd_list (id, realm_id, business, message, start_at, end_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(genId(), realmId, biz, msg, String(start || '').trim(), String(end || '').trim()).run();
  return listMotdsForBusiness(env, biz, realmId);
}

/**
 * Edits one of the caller's OWN notices; the business check is the security.
 *
 * The board was post-and-delete, so fixing a typo meant deleting the notice
 * and writing it again — which loses the schedule with it.
 */
export async function updateMotdForBusiness(env, business, { id, message, start, end }, realmId) {
  const biz = String(business || '').trim();
  const msg = String(message || '').trim();
  if (!msg) throw new Error('Enter a message.');
  const db = await getDb(env);
  const row = await db.prepare('SELECT id FROM motd_list WHERE id = ? AND lower(business) = ? AND realm_id = ?')
    .bind(String(id || '').trim(), biz.toLowerCase(), realmId).first();
  if (!row) throw new Error('Notice not found.');
  await db.prepare('UPDATE motd_list SET message = ?, start_at = ?, end_at = ? WHERE id = ?')
    .bind(msg, String(start || '').trim(), String(end || '').trim(), row.id).run();
  return listMotdsForBusiness(env, biz, realmId);
}

/** Deletes one of the caller's OWN notices; the business check is the security. */
export async function deleteMotdForBusiness(env, business, id, realmId) {
  const biz = String(business || '').trim();
  const db = await getDb(env);
  const row = await db.prepare('SELECT id FROM motd_list WHERE id = ? AND lower(business) = ? AND realm_id = ?')
    .bind(String(id || '').trim(), biz.toLowerCase(), realmId).first();
  if (!row) throw new Error('Notice not found.');
  await db.prepare('DELETE FROM motd_list WHERE id = ?').bind(row.id).run();
  return listMotdsForBusiness(env, biz, realmId);
}

/** Active individual messages for a business right now (respecting start/end). */
export async function activeNoticesForBusiness(env, business, realmId) {
  const target = String(business || '').trim().toLowerCase();
  if (!target) return [];
  const now = Date.now();
  return (await listIndividualMotds(env, realmId))
    .filter((m) => String(m.business).trim().toLowerCase() === target && showing(m, now))
    .map((m) => m.message);
}
