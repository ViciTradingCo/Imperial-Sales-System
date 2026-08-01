/**
 * Messages of the Day.
 *
 *  • Global MOTD — one banner shown to everyone on Home.
 *  • Individual MOTDs — per-business notices with an optional start/end window;
 *    shown on that business's Home while active.
 *  • Expiry warning — an automatic banner for a business's owner/employees when
 *    its certification is near (or past) expiry; the lead time is configurable.
 *
 * Storage in D1:
 *  • sys_flags: 'motd_global' = global message, 'motd_warn_days' = lead days.
 *  • motd_list: id | business | message | start_at | end_at (ISO datetimes).
 */
import { getDb, getFlag, setFlag } from './db.js';

const DEFAULT_WARN_DAYS = 7;

/* ---- global message ---- */
export async function readMotd(env) {
  return (await getFlag(env, 'motd_global')) || '';
}
export async function writeMotd(env, text) {
  const msg = String(text || '').trim();
  await setFlag(env, 'motd_global', msg);
  return msg;
}

/* ---- expiry-warning lead days ---- */
export async function readWarnDays(env) {
  const raw = await getFlag(env, 'motd_warn_days');
  const n = raw != null ? Number(raw) : NaN;
  return isFinite(n) && n >= 0 ? Math.round(n) : DEFAULT_WARN_DAYS;
}
export async function writeWarnDays(env, days) {
  let n = Math.round(Number(days));
  if (!isFinite(n) || n < 0) n = DEFAULT_WARN_DAYS;
  await setFlag(env, 'motd_warn_days', String(n));
  return n;
}

/* ---- individual (per-business, scheduled) messages ---- */
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

export async function listIndividualMotds(env) {
  const db = await getDb(env);
  const { results } = await db.prepare('SELECT * FROM motd_list ORDER BY business').all();
  return (results || []).map(rowToMotd);
}

export async function addIndividualMotd(env, { business, message, start, end }) {
  const biz = String(business || '').trim();
  const msg = String(message || '').trim();
  if (!biz) throw new Error('Pick a business.');
  if (!msg) throw new Error('Enter a message.');
  const db = await getDb(env);
  await db.prepare('INSERT INTO motd_list (id, business, message, start_at, end_at) VALUES (?, ?, ?, ?, ?)')
    .bind(genId(), biz, msg, String(start || '').trim(), String(end || '').trim()).run();
  return listIndividualMotds(env);
}

export async function updateIndividualMotd(env, { id, business, message, start, end }) {
  const db = await getDb(env);
  const target = String(id || '').trim();
  const existing = await db.prepare('SELECT id FROM motd_list WHERE id = ?').bind(target).first();
  if (!existing) throw new Error('Entry not found.');
  await db.prepare('UPDATE motd_list SET business = ?, message = ?, start_at = ?, end_at = ? WHERE id = ?')
    .bind(String(business || '').trim(), String(message || '').trim(), String(start || '').trim(), String(end || '').trim(), target).run();
  return listIndividualMotds(env);
}

export async function deleteIndividualMotd(env, id) {
  const db = await getDb(env);
  const target = String(id || '').trim();
  const existing = await db.prepare('SELECT id FROM motd_list WHERE id = ?').bind(target).first();
  if (!existing) throw new Error('Entry not found.');
  await db.prepare('DELETE FROM motd_list WHERE id = ?').bind(target).run();
  return listIndividualMotds(env);
}

/* ---- owner-scoped notices (a shop's own board, for its staff) ----
 * Same motd_list table; these helpers are hard-scoped to ONE business so an
 * owner can post to their own staff without touching anyone else's notices.
 */
export async function listMotdsForBusiness(env, business) {
  const target = String(business || '').trim().toLowerCase();
  if (!target) return [];
  const db = await getDb(env);
  const { results } = await db.prepare('SELECT * FROM motd_list WHERE lower(business) = ? ORDER BY id DESC').bind(target).all();
  return (results || []).map(rowToMotd);
}

export async function addMotdForBusiness(env, business, { message, start, end }) {
  const biz = String(business || '').trim();
  const msg = String(message || '').trim();
  if (!biz) throw new Error('No business.');
  if (!msg) throw new Error('Enter a message.');
  const db = await getDb(env);
  await db.prepare('INSERT INTO motd_list (id, business, message, start_at, end_at) VALUES (?, ?, ?, ?, ?)')
    .bind(genId(), biz, msg, String(start || '').trim(), String(end || '').trim()).run();
  return listMotdsForBusiness(env, biz);
}

/** Deletes one of the caller's OWN notices; the business check is the security. */
export async function deleteMotdForBusiness(env, business, id) {
  const biz = String(business || '').trim();
  const db = await getDb(env);
  const row = await db.prepare('SELECT id FROM motd_list WHERE id = ? AND lower(business) = ?')
    .bind(String(id || '').trim(), biz.toLowerCase()).first();
  if (!row) throw new Error('Notice not found.');
  await db.prepare('DELETE FROM motd_list WHERE id = ?').bind(row.id).run();
  return listMotdsForBusiness(env, biz);
}

/** Active individual messages for a business right now (respecting start/end). */
export async function activeNoticesForBusiness(env, business) {
  const target = String(business || '').trim().toLowerCase();
  if (!target) return [];
  const now = Date.now();
  return (await listIndividualMotds(env))
    .filter((m) => {
      if (String(m.business).trim().toLowerCase() !== target) return false;
      if (m.start) { const s = Date.parse(m.start); if (isFinite(s) && now < s) return false; }
      if (m.end) { const e = Date.parse(m.end); if (isFinite(e) && now > e) return false; }
      return true;
    })
    .map((m) => m.message);
}
