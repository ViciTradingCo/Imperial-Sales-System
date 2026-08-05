/**
 * The business registry (D1 `companies`) plus the registration logic that ties a
 * person (users row) to a business.
 *
 *   companies: id | business | point_of_contact | until | perpetual | status |
 *              hold | court | priority
 * where `id` is a stable generated business id and `business` (the name) is the
 * human key linking a users row to its business — so we enforce name uniqueness
 * at registration.
 */
import { getDb, renameBusinessData, moveBusinessData, countBusinessTransfers, DEFAULT_REALM_ID } from './db.js';
import { generateCode } from './realm.js';
import { readRealmPrefs } from './realm-prefs.js';
import { cacheGet, cacheSet, cacheBust } from './cache.js';
import { appendUser, findUserByEmail, bustUserCache } from './users.js';

/**
 * The date a new shop's trial runs until, as YYYY-MM-DD — or '' when the realm
 * has set a zero-day trial, which means an admin certifies by hand.
 *
 * The length is a realm setting (Network Settings → New shops), because how much
 * grace a new trader gets is a policy each server decides for itself.
 */
async function trialUntil(env, realmId) {
  const { trialDays } = await readRealmPrefs(env, realmId);
  const days = Math.max(0, Math.floor(Number(trialDays) || 0));
  if (!days) return '';
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Short, collision-resistant application id. */
function genUid(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function rowToCompany(r) {
  return {
    id: String(r.id || '').trim(),
    business: String(r.business || '').trim(),
    pointOfContact: String(r.point_of_contact || '').trim(),
    until: toDateStr(r.until),
    perpetual: Number(r.perpetual) === 1,
    status: String(r.status || '').trim(),
    hold: String(r.hold || '').trim(),
    court: Number(r.court) === 1,
    priority: Number(r.priority) === 1,
    // The staff code an owner hands to their employees. Visible to the shop's
    // own owner and to admins; never listed to anyone else.
    joinCode: String(r.join_code || '').trim(),
    // Which realm this shop belongs to — shown in the admin list once more than
    // one realm exists, so a misfiled shop is obvious at a glance.
    realmId: String(r.realm_id || DEFAULT_REALM_ID).trim() || DEFAULT_REALM_ID,
  };
}

/** Finds a business by name (case-insensitive). Returns { ledgerId, businessName, pointOfContact } or null. */
export async function findBusinessByName(env, name, realmId) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return null;
  const db = await getDb(env);
  const r = await db.prepare('SELECT * FROM companies WHERE lower(business) = ? AND realm_id = ?')
    .bind(target, String(realmId || DEFAULT_REALM_ID)).first();
  if (!r) return null;
  return { ledgerId: String(r.id || '').trim(), businessName: String(r.business || '').trim(), pointOfContact: String(r.point_of_contact || '').trim() };
}

/** All active (non-archived) business names — for pickers like transfer targets. */
export async function listBusinessNames(env, realmId) {
  return (await listBusinessCards(env, realmId)).map((b) => b.business);
}

/**
 * The same list with the details a form might fill in from — currently the
 * region a company trades in, which is what lets recording a delivery from a
 * registered supplier know where the goods came from without asking twice.
 *
 * Deliberately a separate function from listBusinessNames rather than a widened
 * return: half the callers want a list of names to put in a dropdown, and
 * handing them objects would break each one quietly.
 */
export async function listBusinessCards(env, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    "SELECT business, hold FROM companies WHERE upper(status) != 'ARCHIVED' AND business != '' AND realm_id = ? ORDER BY business")
    .bind(String(realmId || DEFAULT_REALM_ID)).all();
  return (results || []).map((r) => ({ business: String(r.business).trim(), hold: String(r.hold || '').trim() }));
}

/** Returns a business's Hold / Court / Priority flags ({ hold, court, priority }). */
export async function findBusinessMeta(env, name, realmId) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return { hold: '', court: false, priority: false };
  const realm = String(realmId || DEFAULT_REALM_ID);
  const cached = await cacheGet(env, 'meta:' + realm + ':' + target);
  if (cached) return cached;
  const db = await getDb(env);
  const r = await db.prepare('SELECT hold, court, priority FROM companies WHERE lower(business) = ? AND realm_id = ?')
    .bind(target, realm).first();
  const res = r
    ? { hold: String(r.hold || '').trim(), court: Number(r.court) === 1, priority: Number(r.priority) === 1 }
    : { hold: '', court: false, priority: false };
  await cacheSet(env, 'meta:' + realm + ':' + target, res, 60000);
  return res;
}

/** A shop's staff code, for its own owner or an admin. */
export async function businessJoinCode(env, business, realmId) {
  const db = await getDb(env);
  const r = await db.prepare('SELECT join_code FROM companies WHERE realm_id = ? AND lower(business) = ?')
    .bind(String(realmId || DEFAULT_REALM_ID), String(business || '').trim().toLowerCase()).first();
  if (!r) throw new Error('Company not found.');
  // A shop registered before staff codes existed gets one on first look.
  if (!r.join_code) return regenerateBusinessCode(env, business, realmId);
  return r.join_code;
}

/**
 * Issues a fresh staff code, invalidating the old one. The reason this exists:
 * a code that leaked into the wrong Discord channel lets strangers register into
 * the shop, and the fix has to be immediate.
 */
export async function regenerateBusinessCode(env, business, realmId) {
  const db = await getDb(env);
  const realm = String(realmId || DEFAULT_REALM_ID);
  const target = String(business || '').trim().toLowerCase();
  const existing = await db.prepare('SELECT id FROM companies WHERE realm_id = ? AND lower(business) = ?')
    .bind(realm, target).first();
  if (!existing) throw new Error('Company not found.');
  const code = generateCode('SHOP');
  await db.prepare('UPDATE companies SET join_code = ? WHERE id = ?').bind(code, existing.id).run();
  return code;
}

/** Invalidates the cert + business-meta caches (call on any registry change). */
function bustRegistryCache() { cacheBust('cert:'); cacheBust('meta:'); }

/**
 * Moves a company and everything it owns into another realm — the corrective
 * action when a shop was registered under the wrong server. Its members go with
 * it, since a shop without its staff is not a working shop.
 *
 * Refused when the name is taken in the destination (names are unique per realm)
 * or when a transfer is still pending, because a transfer names two shops and
 * the other end would be left pointing at a company its realm cannot see.
 */
export async function transferCompany(env, id, toRealm, fromRealm) {
  const target = String(id || '').trim();
  const to = String(toRealm || '').trim();
  if (!target) throw new Error('Missing company id.');
  if (!to) throw new Error('Pick a destination realm.');
  const from = String(fromRealm || DEFAULT_REALM_ID);
  const db = await getDb(env);

  const co = await db.prepare('SELECT * FROM companies WHERE id = ? AND realm_id = ?').bind(target, from).first();
  if (!co) throw new Error('Company not found.');
  if (from === to) return rowToCompany(co);

  const realm = await db.prepare('SELECT id FROM realms WHERE id = ?').bind(to).first();
  if (!realm) throw new Error('That realm no longer exists.');

  const business = String(co.business || '').trim();
  const clash = await db.prepare('SELECT id FROM companies WHERE realm_id = ? AND lower(business) = ?')
    .bind(to, business.toLowerCase()).first();
  if (clash) throw new Error('A company named "' + business + '" already exists in the destination realm.');

  const pending = await countBusinessTransfers(env, business, from, true);
  if (pending) {
    throw new Error('Settle this shop\'s ' + pending + ' pending transfer(s) before moving it to another realm.');
  }

  // Members must not collide with an email already registered over there.
  const { results: members } = await db.prepare('SELECT uid, email FROM users WHERE realm_id = ? AND lower(business) = ?')
    .bind(from, business.toLowerCase()).all();
  for (const m of members || []) {
    const taken = await db.prepare('SELECT uid FROM users WHERE realm_id = ? AND lower(email) = ?')
      .bind(to, String(m.email || '').trim().toLowerCase()).first();
    if (taken) throw new Error(m.email + ' is already registered in the destination realm.');
  }

  await moveBusinessData(env, business, from, to);
  bustRegistryCache();
  bustUserCache();
  return { moved: business, from, to, members: (members || []).length };
}

/**
 * Registers the signed-in user. Idempotent: if they already exist, returns the
 * existing record. Otherwise:
 *   asOwner=true  → the business name must be FREE; we mint a company row and
 *                   create an active owner.
 *   asOwner=false → the business name must ALREADY EXIST; we create a pending
 *                   employee awaiting owner/admin activation.
 */
export async function registerUser(env, { email, name, character, businessName, asOwner, hold, realmId }) {
  const existing = await findUserByEmail(env, email);
  if (existing) return { ...existing, alreadyRegistered: true };
  const realm = String(realmId || DEFAULT_REALM_ID);

  const char = String(character || '').trim();
  if (!char) throw new Error('Enter your character\'s name.');
  const biz = String(businessName || '').trim();
  if (!biz) throw new Error('A business name is required to register.');

  const found = await findBusinessByName(env, biz, realm);
  const db = await getDb(env);

  if (asOwner) {
    if (found) {
      throw new Error('A business named "' + biz + '" is already registered. If you own it, ask an admin to link your account; otherwise choose a different name.');
    }
    const businessId = genUid('biz');
    // Mint the shop's staff code now: the owner needs something to hand their
    // employees the moment the shop exists. The shop also opens certified for a
    // short trial, so a new owner can trade immediately.
    await db.prepare('INSERT INTO companies (id, business, point_of_contact, until, perpetual, status, hold, court, priority, realm_id, join_code) VALUES (?, ?, ?, ?, 0, ?, ?, 0, 0, ?, ?)')
      .bind(businessId, biz, char, await trialUntil(env, realm), '', String(hold || '').trim(), realm, generateCode('SHOP')).run();
    bustRegistryCache();
    return appendUser(env, { uid: genUid('usr'), email, character: char, business: biz, role: 'owner', isOwner: true, status: 'active', realmId: realm });
  }

  // Employee path
  if (!found) {
    throw new Error('No business named "' + biz + '" is registered yet. Ask its owner to register it first, or register as its owner if it\'s yours.');
  }
  return appendUser(env, { uid: genUid('usr'), email, character: char, business: found.businessName, role: 'employee', isOwner: false, status: 'pending', realmId: realm });
}

/**
 * Renames a business everywhere it's referenced (the name is the key linking the
 * company row, its members, and its per-business settings + D1 data).
 */
export async function renameBusiness(env, oldName, newName, realmId) {
  const old = String(oldName || '').trim();
  const nw = String(newName || '').trim();
  if (!nw) throw new Error('Enter a company name.');
  const realm = String(realmId || DEFAULT_REALM_ID);

  // Uniqueness — allow a case-only change of the SAME business, block colliding
  // with a different one. Names only need to be unique WITHIN a realm.
  const clash = await findBusinessByName(env, nw, realm);
  if (clash && clash.businessName.trim().toLowerCase() !== old.toLowerCase()) {
    throw new Error('A business named "' + nw + '" already exists.');
  }
  await renameBusinessData(env, old, nw, realm); // companies, users, settings + all data
  bustRegistryCache();
  bustUserCache(); // a renamed business changes cached members' business field
  return nw;
}

function toDateStr(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function statusFromDate(untilStr) {
  const d = new Date(untilStr);
  if (isNaN(d.getTime())) return 'EXPIRED';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return d >= today ? 'VALID' : 'EXPIRED';
}

/** All registered (non-archived) companies (admin company list). */
export async function listCompanies(env, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    "SELECT * FROM companies WHERE upper(status) != 'ARCHIVED' AND realm_id = ? ORDER BY business")
    .bind(String(realmId || DEFAULT_REALM_ID)).all();
  return (results || []).map(rowToCompany);
}

/**
 * Admin edit of a company (targeted by its stable id): rename (propagated
 * everywhere) and/or set the subscription expiry + Perpetual + Hold/Court/Priority.
 */
export async function updateCompany(env, { id, name, until, perpetual, hold, court, priority }, realmId) {
  const targetId = String(id || '').trim();
  if (!targetId) throw new Error('Missing company id.');
  const realm = String(realmId || DEFAULT_REALM_ID);
  const db = await getDb(env);
  const current = await db.prepare('SELECT * FROM companies WHERE id = ? AND realm_id = ?').bind(targetId, realm).first();
  if (!current) throw new Error('Company not found.');

  const oldName = String(current.business || '').trim();
  const newName = String(name || '').trim();
  if (!newName) throw new Error('Company name is required.');
  if (newName !== oldName) await renameBusiness(env, oldName, newName, realm);

  const perp = !!perpetual;
  const untilStr = perp ? '' : String(until || '').trim();
  const status = perp ? 'VALID' : statusFromDate(untilStr);
  const holdStr = hold === undefined ? String(current.hold || '').trim() : String(hold || '').trim();
  const courtBool = court === undefined ? Number(current.court) === 1 : !!court;
  const prioBool = priority === undefined ? Number(current.priority) === 1 : !!priority;

  await db.prepare('UPDATE companies SET until = ?, perpetual = ?, status = ?, hold = ?, court = ?, priority = ? WHERE id = ? AND realm_id = ?')
    .bind(untilStr, perp ? 1 : 0, status, holdStr, courtBool ? 1 : 0, prioBool ? 1 : 0, targetId, realm).run();

  bustRegistryCache();
  return listCompanies(env, realm);
}

/**
 * Archives (the delete action) a company. Its market data is RETAINED for
 * analysis but moved out of reach of any future company: we rename the business
 * — and all its records — to a unique archived key, mark the row ARCHIVED, and
 * free the original name for re-use. A remade company starts clean and can never
 * pull the archived company's history.
 */
export async function archiveCompany(env, id, realmId) {
  const targetId = String(id || '').trim();
  if (!targetId) throw new Error('Missing company id.');
  const realm = String(realmId || DEFAULT_REALM_ID);
  const db = await getDb(env);
  const current = await db.prepare('SELECT * FROM companies WHERE id = ? AND realm_id = ?').bind(targetId, realm).first();
  if (!current) throw new Error('Company not found.');
  if (String(current.status || '').trim().toUpperCase() === 'ARCHIVED') return listCompanies(env, realm);

  const oldName = String(current.business || '').trim();
  const archivedName = oldName + ' [archived ' + Date.now().toString(36) + ']';
  await renameBusiness(env, oldName, archivedName, realm); // moves the name everywhere, incl. D1 data
  await db.prepare("UPDATE companies SET status = 'ARCHIVED' WHERE id = ? AND realm_id = ?").bind(targetId, realm).run();

  bustRegistryCache();
  return listCompanies(env, realm);
}
