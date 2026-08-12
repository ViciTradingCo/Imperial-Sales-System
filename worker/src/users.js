/**
 * The Users registry — maps a verified Google email to an application identity
 * (UID), a business, and a role. This is the source of truth for authorization;
 * every request resolves the caller here. Stored in D1 (`users`).
 *
 * Roles: 'admin' | 'owner' | 'manager' | 'employee'. Status: 'active' | 'pending'.
 *
 * A MANAGER is an employee an owner has appointed to run the shop: everything
 * the owner does day to day, except what would let them change who has power
 * or what people are paid. See guards.js — the line is drawn there, once.
 *
 * The first admin needs no hand-seeded row: any email listed in the
 * ADMIN_EMAILS worker var is treated as an admin, and auto-provisioned a row on
 * first sign-in. See docs/SETUP.md.
 */
import { getDb, DEFAULT_REALM_ID } from './db.js';
import { revokeSessionsFor } from './sessions.js';

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
    // What this person is paid per hour, for the time card. Set by their owner
    // on the roster; 0 means nobody has set one, and the log says so rather
    // than quietly valuing their shifts at nothing.
    payRate: Number(r.pay_rate) || 0,
    // A share of what they SELL, as a percentage of the sale. Independent of
    // the hourly rate on purpose: a shop may pay by the hour, by results, or
    // both, and 0 for either simply means that half is not part of the deal.
    commissionRate: Number(r.commission_rate) || 0,
    // The realm this account BELONGS to. It comes only from this row, never
    // from the request, so it is the caller's permanent home.
    realmId: String(r.realm_id || DEFAULT_REALM_ID).trim() || DEFAULT_REALM_ID,
    // The realm a super admin is currently VIEWING. Empty for everyone else —
    // guards.realmIdOf() falls back to realmId, so an ordinary account can
    // never read outside its own realm even if this column were set.
    activeRealm: String(r.active_realm || '').trim(),
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
/**
 * Sets an employee's hourly pay rate. Owner's call, on their own roster.
 *
 * Applies to shifts from here on: a finished shift keeps the rate it was
 * stamped with, so a raise never restates what past work was worth.
 */
export async function setPayRate(env, uid, rate, realmId, commissionRate) {
  const target = String(uid || '').trim();
  if (!target) throw new Error('Which employee?');
  const n = Number(rate);
  if (!isFinite(n) || n < 0) throw new Error('A pay rate must be a number ≥ 0.');
  // Omitted means "leave it alone", so a screen that only knows about the
  // hourly rate can never silently wipe someone's commission.
  const commGiven = commissionRate !== undefined && commissionRate !== null && String(commissionRate).trim() !== '';
  let c = 0;
  if (commGiven) {
    c = Number(commissionRate);
    // A percentage over 100 would pay out more than the sale took. Refused
    // rather than clamped: it is a typo, and silently making it 100 would hide
    // that from the person who typed it.
    if (!isFinite(c) || c < 0) throw new Error('A commission must be a number ≥ 0.');
    if (c > 100) throw new Error('A commission cannot be more than 100% of the sale.');
  }
  const realm = String(realmId || DEFAULT_REALM_ID);
  const db = await getDb(env);
  const existing = await db.prepare('SELECT uid FROM users WHERE uid = ? AND realm_id = ?')
    .bind(target, realm).first();
  if (!existing) throw new Error('Member not found.');
  await db.prepare(
    `UPDATE users SET pay_rate = ?,
       commission_rate = CASE WHEN ? THEN ? ELSE commission_rate END
     WHERE uid = ? AND realm_id = ?`)
    .bind(n, commGiven ? 1 : 0, c, target, realm).run();
  bustUserCache();
  return { rate: n, commissionRate: commGiven ? c : Number(existing.commission_rate) || 0 };
}


/**
 * Promotes an employee to MANAGER, or puts a manager back to employee.
 *
 * Deliberately narrow: it moves a row between exactly those two roles and
 * nothing else. An owner cannot make another owner or an admin here — that is
 * a realm admin's job on the Member List — so the worst this can do inside one
 * shop is give somebody the shop's own day-to-day powers, which is what
 * appointing a manager IS.
 *
 * `is_owner` is left alone: a manager is not an owner, and the flag is what
 * several screens read to decide whose shop it is.
 */
export async function setManagerRole(env, uid, makeManager, realmId) {
  const target = String(uid || '').trim();
  if (!target) throw new Error('Which employee?');
  const realm = String(realmId || DEFAULT_REALM_ID);
  const db = await getDb(env);
  const row = await db.prepare('SELECT uid, role FROM users WHERE uid = ? AND realm_id = ?')
    .bind(target, realm).first();
  if (!row) throw new Error('Member not found.');
  const role = String(row.role || '').toLowerCase();
  // An owner or an admin is not something this may reach down and rewrite.
  if (role !== 'employee' && role !== 'manager') {
    throw new Error('Only an employee can be made a manager.');
  }
  const next = makeManager ? 'manager' : 'employee';
  await db.prepare('UPDATE users SET role = ? WHERE uid = ? AND realm_id = ?').bind(next, target, realm).run();
  bustUserCache();
  return next;
}

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
  if (!['admin', 'owner', 'manager', 'employee'].includes(r)) throw new Error('Role must be admin, owner, manager, or employee.');
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
  const existing = await db.prepare('SELECT uid, email FROM users WHERE uid = ? AND realm_id = ?').bind(target, realm).first();
  if (!existing) throw new Error('Member not found.');
  await db.prepare('DELETE FROM users WHERE uid = ? AND realm_id = ?').bind(target, realm).run();
  // Their signed-in sessions go with them. A session only ever proves identity —
  // with no user row there is nothing left to authorize — but an account that
  // has been deleted should not leave live credentials lying in a table.
  await revokeSessionsFor(env, existing.email);
  bustUserCache();
}

/**
 * Sets which realm a super admin is VIEWING. Passing their own realm (or an
 * empty value) clears the override. The caller must have already established
 * that this user may switch realms — see guards.requireSystemAdmin.
 */
export async function setActiveRealm(env, uid, realmId) {
  const db = await getDb(env);
  const target = String(realmId || '').trim();
  if (target) {
    const realm = await db.prepare('SELECT id FROM realms WHERE id = ?').bind(target).first();
    if (!realm) throw new Error('That realm no longer exists.');
  }
  await db.prepare('UPDATE users SET active_realm = ? WHERE uid = ?').bind(target, uid).run();
  return target;
}

/**
 * Moves ONE member to another realm — the fix for someone registering under the
 * wrong server. Their business does NOT follow them; a member landing in a realm
 * where their business doesn't exist is cleared to no business, so they show up
 * as unassigned rather than pointing at a shop that isn't there.
 */
export async function transferMember(env, uid, toRealm, fromRealm) {
  const target = String(uid || '').trim();
  const to = String(toRealm || '').trim();
  if (!target) throw new Error('Missing member uid.');
  if (!to) throw new Error('Pick a destination realm.');
  const db = await getDb(env);
  const from = String(fromRealm || DEFAULT_REALM_ID);
  const row = await db.prepare('SELECT * FROM users WHERE uid = ? AND realm_id = ?').bind(target, from).first();
  if (!row) throw new Error('Member not found.');
  if (from === to) return rowToUser(row);

  const realm = await db.prepare('SELECT id FROM realms WHERE id = ?').bind(to).first();
  if (!realm) throw new Error('That realm no longer exists.');
  // One email per realm — refuse rather than trip the unique index.
  const clash = await db.prepare('SELECT uid FROM users WHERE realm_id = ? AND lower(email) = ?')
    .bind(to, String(row.email || '').trim().toLowerCase()).first();
  if (clash) throw new Error('That email is already registered in the destination realm.');

  // Keep the business only if a company of that name exists over there.
  const biz = String(row.business || '').trim();
  const keeps = biz
    ? await db.prepare('SELECT business FROM companies WHERE realm_id = ? AND lower(business) = ?')
        .bind(to, biz.toLowerCase()).first()
    : null;
  await db.prepare("UPDATE users SET realm_id = ?, business = ?, active_realm = '' WHERE uid = ?")
    .bind(to, keeps ? keeps.business : '', target).run();
  bustUserCache();
  return { uid: target, realmId: to, business: keeps ? keeps.business : '', businessCleared: !!biz && !keeps };
}

/** Best-effort Last Seen stamp. Never throws into the caller. */
export async function touchLastSeen(env, uid) {
  try {
    const db = await getDb(env);
    await db.prepare('UPDATE users SET last_seen = ? WHERE uid = ?').bind(new Date().toISOString(), uid).run();
  } catch (e) { /* non-critical */ }
}
