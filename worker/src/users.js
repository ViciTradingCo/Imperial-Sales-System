/**
 * The Users registry — maps a verified Google email to an application identity
 * (UID), a business, and a role. This is the source of truth for authorization;
 * every request resolves the caller here. Stored in D1 (`users`).
 *
 * Roles: 'admin' | 'owner' | 'employee'. Status: 'active' | 'pending'.
 *
 * The first admin needs no hand-seeded row: any email listed in the
 * ADMIN_EMAILS worker var is treated as an admin, and auto-provisioned a row on
 * first sign-in. See docs/SETUP.md.
 */
import { getDb, DEFAULT_REALM_ID } from './db.js';

/** Emails granted admin by configuration (comma-separated ADMIN_EMAILS var). */
function adminEmails(env) {
  return String(env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
export function isConfiguredAdmin(env, email) {
  return adminEmails(env).includes(String(email || '').trim().toLowerCase());
}

function rowToUser(r) {
  if (!r) return null;
  return {
    uid: String(r.uid || '').trim(),
    email: String(r.email || '').trim(),
    business: String(r.business || '').trim(),
    role: String(r.role || '').trim().toLowerCase() || 'employee',
    isOwner: Number(r.is_owner) === 1,
    status: String(r.status || '').trim().toLowerCase() || 'active',
    character: String(r.char_name || '').trim(),
    notes: String(r.notes || '').trim(),
    // Which realm this account belongs to. Every downstream query scopes to it,
    // and it comes ONLY from this row — never from the request.
    realmId: String(r.realm_id || DEFAULT_REALM_ID).trim() || DEFAULT_REALM_ID,
  };
}

function genUid(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Looks up a user by verified email. A configured admin (ADMIN_EMAILS) is always
 * returned as an active admin — auto-provisioned a row the first time. Returns a
 * normalized record or null when the email isn't registered.
 *
 * Identity is read LIVE from D1 on every call (no caching). A per-isolate cache
 * here caused a stale-identity bug: after someone changed business (re-register,
 * admin edit, company archive), other isolates kept serving the OLD business
 * until the entry expired. D1 reads are cheap, so correctness wins.
 *
 * MULTI-REALM: an email belongs to ONE realm — sign-in carries no realm, so the
 * account's own row decides which realm the session operates in. Everything
 * downstream scopes to user.realmId.
 */
export async function findUserByEmail(env, email) {
  const target = String(email || '').trim().toLowerCase();
  if (!target) return null;

  const db = await getDb(env);
  const row = await db.prepare('SELECT * FROM users WHERE lower(email) = ?').bind(target).first();
  let user = rowToUser(row);

  if (!user && isConfiguredAdmin(env, target)) {
    // First sign-in of a configured admin — provision an admin row so they
    // appear in the member list and can be managed like anyone else.
    user = await appendUser(env, {
      uid: genUid('usr'), email: target, business: '', role: 'admin', isOwner: false, status: 'active', character: '',
    });
  } else if (user && isConfiguredAdmin(env, target) && user.role !== 'admin') {
    // A listed admin whose stored role drifted — enforce admin.
    await db.prepare('UPDATE users SET role = ?, status = ? WHERE uid = ?').bind('admin', 'active', user.uid).run();
    user.role = 'admin'; user.status = 'active';
  }
  return user ? { ...user } : null;
}

/** No-op retained for call sites; identity is no longer cached (see findUserByEmail). */
export function bustUserCache() { /* identity reads are live now */ }

/**
 * Locate a user by uid WITHIN a realm (admin cross-business operations). The
 * realm filter is the isolation boundary: a realm admin holding a uid from
 * another realm simply gets null.
 */
export async function findUserByUid(env, uid, realmId) {
  const target = String(uid || '').trim();
  if (!target) return null;
  const db = await getDb(env);
  return rowToUser(await db.prepare('SELECT * FROM users WHERE uid = ? AND realm_id = ?')
    .bind(target, String(realmId || DEFAULT_REALM_ID)).first());
}

/** Every user in the system (admin member list). */
export async function listAllUsers(env, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare('SELECT * FROM users WHERE realm_id = ? ORDER BY business, char_name')
    .bind(String(realmId || DEFAULT_REALM_ID)).all();
  return (results || []).map((r) => {
    const u = rowToUser(r);
    return { uid: u.uid, email: u.email, character: u.character, business: u.business, role: u.role, isOwner: u.isOwner, status: u.status, realmId: u.realmId };
  });
}

/** Every user belonging to a business (case-insensitive match on the name). */
export async function listUsersByBusiness(env, business, realmId) {
  const target = String(business || '').trim().toLowerCase();
  if (!target) return [];
  const db = await getDb(env);
  const { results } = await db.prepare('SELECT * FROM users WHERE lower(business) = ? AND realm_id = ?')
    .bind(target, String(realmId || DEFAULT_REALM_ID)).all();
  return (results || []).map(rowToUser);
}

/** Inserts a new user row. Returns the written record. */
export async function appendUser(env, { uid, email, business, role, isOwner, status, character, realmId }) {
  const now = new Date().toISOString();
  const realm = String(realmId || DEFAULT_REALM_ID).trim() || DEFAULT_REALM_ID;
  const db = await getDb(env);
  await db.prepare(
    'INSERT INTO users (uid, email, business, role, is_owner, status, char_name, notes, created, last_seen, realm_id) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(uid, email, business || '', role, isOwner ? 1 : 0, status, character || '', '', now, now, realm).run();
  bustUserCache();
  return { uid, email, business: business || '', role, isOwner: !!isOwner, status, character: character || '', realmId: realm };
}

/** Sets a user's Status by uid. */
export async function setUserStatus(env, uid, status) {
  const db = await getDb(env);
  await db.prepare('UPDATE users SET status = ? WHERE uid = ?').bind(status, uid).run();
  bustUserCache();
}

/** Sets a user's character name by uid. */
export async function setUserCharacter(env, uid, character) {
  const db = await getDb(env);
  await db.prepare('UPDATE users SET char_name = ? WHERE uid = ?').bind(String(character || '').trim(), uid).run();
  bustUserCache();
}

/** Sets a user's owner-only note by uid. */
export async function setUserNote(env, uid, note) {
  const db = await getDb(env);
  await db.prepare('UPDATE users SET notes = ? WHERE uid = ?').bind(String(note || '').trim(), uid).run();
  bustUserCache();
}

/** Admin edit of a member (by UID): character, company, and role. */
export async function updateMember(env, { uid, character, business, role }, realmId) {
  const target = String(uid || '').trim();
  if (!target) throw new Error('Missing member uid.');
  const r = String(role || '').trim().toLowerCase();
  if (!['admin', 'owner', 'employee'].includes(r)) throw new Error('Role must be admin, owner, or employee.');
  const realm = String(realmId || DEFAULT_REALM_ID);
  const db = await getDb(env);
  const existing = await db.prepare('SELECT uid FROM users WHERE uid = ? AND realm_id = ?').bind(target, realm).first();
  if (!existing) throw new Error('Member not found.');
  await db.prepare('UPDATE users SET business = ?, role = ?, is_owner = ?, char_name = ? WHERE uid = ? AND realm_id = ?')
    .bind(String(business || '').trim(), r, r === 'owner' ? 1 : 0, String(character || '').trim(), target, realm).run();
  bustUserCache();
}

/** Admin delete of a member (by UID). The member disappears and can register again fresh. */
export async function deleteMember(env, uid, realmId) {
  const target = String(uid || '').trim();
  if (!target) throw new Error('Missing member uid.');
  const realm = String(realmId || DEFAULT_REALM_ID);
  const db = await getDb(env);
  const existing = await db.prepare('SELECT uid FROM users WHERE uid = ? AND realm_id = ?').bind(target, realm).first();
  if (!existing) throw new Error('Member not found.');
  await db.prepare('DELETE FROM users WHERE uid = ? AND realm_id = ?').bind(target, realm).run();
  bustUserCache();
}

/** Best-effort Last Seen stamp. Never throws into the caller. */
export async function touchLastSeen(env, uid) {
  try {
    const db = await getDb(env);
    await db.prepare('UPDATE users SET last_seen = ? WHERE uid = ?').bind(new Date().toISOString(), uid).run();
  } catch (e) { /* non-critical */ }
}
