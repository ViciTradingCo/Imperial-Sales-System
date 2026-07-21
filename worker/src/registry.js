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
import { getDb, renameBusinessData } from './db.js';
import { cacheGet, cacheSet, cacheBust } from './cache.js';
import { appendUser, findUserByEmail, bustUserCache } from './users.js';

/** Short, collision-resistant application id. */
export function genUid(prefix) {
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
  };
}

/** Finds a business by name (case-insensitive). Returns { ledgerId, businessName, pointOfContact } or null. */
export async function findBusinessByName(env, name) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return null;
  const db = await getDb(env);
  const r = await db.prepare('SELECT * FROM companies WHERE lower(business) = ?').bind(target).first();
  if (!r) return null;
  return { ledgerId: String(r.id || '').trim(), businessName: String(r.business || '').trim(), pointOfContact: String(r.point_of_contact || '').trim() };
}

/** All active (non-archived) business names — for pickers like transfer targets. */
export async function listBusinessNames(env) {
  const db = await getDb(env);
  const { results } = await db.prepare("SELECT business FROM companies WHERE upper(status) != 'ARCHIVED' AND business != '' ORDER BY business").all();
  return (results || []).map((r) => String(r.business).trim());
}

/** Returns a business's Hold / Court / Priority flags ({ hold, court, priority }). */
export async function findBusinessMeta(env, name) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return { hold: '', court: false, priority: false };
  const cached = await cacheGet(env, 'meta:' + target);
  if (cached) return cached;
  const db = await getDb(env);
  const r = await db.prepare('SELECT hold, court, priority FROM companies WHERE lower(business) = ?').bind(target).first();
  const res = r
    ? { hold: String(r.hold || '').trim(), court: Number(r.court) === 1, priority: Number(r.priority) === 1 }
    : { hold: '', court: false, priority: false };
  await cacheSet(env, 'meta:' + target, res, 60000);
  return res;
}

/** Invalidates the cert + business-meta caches (call on any registry change). */
export function bustRegistryCache() { cacheBust('cert:'); cacheBust('meta:'); }

/**
 * Registers the signed-in user. Idempotent: if they already exist, returns the
 * existing record. Otherwise:
 *   asOwner=true  → the business name must be FREE; we mint a company row and
 *                   create an active owner.
 *   asOwner=false → the business name must ALREADY EXIST; we create a pending
 *                   employee awaiting owner/admin activation.
 */
export async function registerUser(env, { email, name, character, businessName, asOwner, hold }) {
  const existing = await findUserByEmail(env, email);
  if (existing) return { ...existing, alreadyRegistered: true };

  const char = String(character || '').trim();
  if (!char) throw new Error('Enter your character\'s name.');
  const biz = String(businessName || '').trim();
  if (!biz) throw new Error('A business name is required to register.');

  const found = await findBusinessByName(env, biz);
  const db = await getDb(env);

  if (asOwner) {
    if (found) {
      throw new Error('A business named "' + biz + '" is already registered. If you own it, ask an admin to link your account; otherwise choose a different name.');
    }
    const businessId = genUid('biz');
    await db.prepare('INSERT INTO companies (id, business, point_of_contact, until, perpetual, status, hold, court, priority) VALUES (?, ?, ?, ?, 0, ?, ?, 0, 0)')
      .bind(businessId, biz, char, '', '', String(hold || '').trim()).run();
    bustRegistryCache();
    return appendUser(env, { uid: genUid('usr'), email, character: char, business: biz, role: 'owner', isOwner: true, status: 'active' });
  }

  // Employee path
  if (!found) {
    throw new Error('No business named "' + biz + '" is registered yet. Ask its owner to register it first, or register as its owner if it\'s yours.');
  }
  return appendUser(env, { uid: genUid('usr'), email, character: char, business: found.businessName, role: 'employee', isOwner: false, status: 'pending' });
}

/**
 * Renames a business everywhere it's referenced (the name is the key linking the
 * company row, its members, and its per-business settings + D1 data).
 */
export async function renameBusiness(env, oldName, newName) {
  const old = String(oldName || '').trim();
  const nw = String(newName || '').trim();
  if (!nw) throw new Error('Enter a company name.');

  // Uniqueness — allow a case-only change of the SAME business, block colliding
  // with a different one.
  const clash = await findBusinessByName(env, nw);
  if (clash && clash.businessName.trim().toLowerCase() !== old.toLowerCase()) {
    throw new Error('A business named "' + nw + '" already exists.');
  }
  await renameBusinessData(env, old, nw); // companies, users, business_settings + all D1 data
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
export async function listCompanies(env) {
  const db = await getDb(env);
  const { results } = await db.prepare("SELECT * FROM companies WHERE upper(status) != 'ARCHIVED' ORDER BY business").all();
  return (results || []).map(rowToCompany);
}

/**
 * Admin edit of a company (targeted by its stable id): rename (propagated
 * everywhere) and/or set the subscription expiry + Perpetual + Hold/Court/Priority.
 */
export async function updateCompany(env, { id, name, until, perpetual, hold, court, priority }) {
  const targetId = String(id || '').trim();
  if (!targetId) throw new Error('Missing company id.');
  const db = await getDb(env);
  const current = await db.prepare('SELECT * FROM companies WHERE id = ?').bind(targetId).first();
  if (!current) throw new Error('Company not found.');

  const oldName = String(current.business || '').trim();
  const newName = String(name || '').trim();
  if (!newName) throw new Error('Company name is required.');
  if (newName !== oldName) await renameBusiness(env, oldName, newName);

  const perp = !!perpetual;
  const untilStr = perp ? '' : String(until || '').trim();
  const status = perp ? 'VALID' : statusFromDate(untilStr);
  const holdStr = hold === undefined ? String(current.hold || '').trim() : String(hold || '').trim();
  const courtBool = court === undefined ? Number(current.court) === 1 : !!court;
  const prioBool = priority === undefined ? Number(current.priority) === 1 : !!priority;

  await db.prepare('UPDATE companies SET until = ?, perpetual = ?, status = ?, hold = ?, court = ?, priority = ? WHERE id = ?')
    .bind(untilStr, perp ? 1 : 0, status, holdStr, courtBool ? 1 : 0, prioBool ? 1 : 0, targetId).run();

  bustRegistryCache();
  return listCompanies(env);
}

/**
 * Archives (the delete action) a company. Its market data is RETAINED for
 * analysis but moved out of reach of any future company: we rename the business
 * — and all its records — to a unique archived key, mark the row ARCHIVED, and
 * free the original name for re-use. A remade company starts clean and can never
 * pull the archived company's history.
 */
export async function archiveCompany(env, id) {
  const targetId = String(id || '').trim();
  if (!targetId) throw new Error('Missing company id.');
  const db = await getDb(env);
  const current = await db.prepare('SELECT * FROM companies WHERE id = ?').bind(targetId).first();
  if (!current) throw new Error('Company not found.');
  if (String(current.status || '').trim().toUpperCase() === 'ARCHIVED') return listCompanies(env);

  const oldName = String(current.business || '').trim();
  const archivedName = oldName + ' [archived ' + Date.now().toString(36) + ']';
  await renameBusiness(env, oldName, archivedName); // moves the name everywhere, incl. D1 data
  await db.prepare("UPDATE companies SET status = 'ARCHIVED' WHERE id = ?").bind(targetId).run();

  bustRegistryCache();
  return listCompanies(env);
}
