/**
 * Authorization guards — the enforcement side of the trust boundary. Every
 * protected route resolves the caller through one of these; they verify the
 * Google ID token and map it to a registry identity + role.
 */
import { verifyIdToken } from './verify.js';
import { findUserByEmail, isConfiguredAdmin } from './users.js';
import { markPriority } from './ratelimit.js';
import { findBusinessMeta } from './registry.js';
import { DEFAULT_REALM_ID } from './db.js';
import { isSessionToken, resolveSession } from './sessions.js';

/**
 * Resolves the Bearer credential on a request to a verified identity, or throws.
 *
 * TWO KINDS OF CREDENTIAL, one answer. A Google ID token is verified against
 * Google's JWKS; one of our own session tokens is looked up in D1. Both come
 * back as `{ email, name }`, because everything downstream cares about the
 * email and nothing else — which is what lets the session token exist at all
 * without a second authorization path to keep in step with this one.
 *
 * A session proves identity, never authorization: the role, the business, the
 * realm and the account's status are read from the user row on every request,
 * so a session issued yesterday grants exactly what the account is owed today.
 */
export async function requireUser(request, env) {
  const raw = bearerToken(request);
  if (!raw) throw new Error('Missing bearer token.');
  if (isSessionToken(raw)) {
    const session = await resolveSession(env, raw);
    if (!session) throw new Error('Your session has expired — signing you back in.');
    return { email: session.email, name: session.name };
  }
  return verifyIdToken(raw, env.GOOGLE_CLIENT_ID);
}

/** The raw bearer token string (for rate-limit priority tagging), or ''. */
export function bearerToken(request) {
  return (String(request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i) || [])[1] || '';
}

/** Verifies the token AND requires the caller to be a registered user. */
export async function requireRegistered(request, env) {
  const payload = await requireUser(request, env);
  const user = await findUserByEmail(env, payload.email);
  if (!user) {
    const err = new Error('You are not registered yet.');
    err.notRegistered = true;
    err.payload = payload;
    throw err;
  }
  return user;
}

/** Requires an admin — Realm Admin or System Admin. Scoped to their realm. */
export async function requireAdmin(request, env) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'admin') {
    const e = new Error('Admins only.');
    e.forbidden = true;
    throw e;
  }
  return caller;
}

/**
 * A SYSTEM ADMIN — an email in ADMIN_EMAILS. They run the deployment: creating,
 * renaming and deleting realms, moving people between them, and switching which
 * realm they are viewing.
 *
 * The other kind is a REALM ADMIN: role 'admin' without an ADMIN_EMAILS entry.
 * They are a full administrator of their OWN realm — members, companies, items,
 * MOTD, audit, settings — and cannot see or touch any other. That confinement is
 * not a UI choice: guards.realmIdOf refuses to return anything but their own
 * realm, so every query they make is scoped to it.
 *
 * System Admin is granted by deployment config rather than in the app on
 * purpose: it is the one role that can cross realm boundaries, so it should not
 * be grantable by anyone who is merely an admin of one realm.
 */
export async function requireSystemAdmin(request, env) {
  const caller = await requireAdmin(request, env);
  if (!isConfiguredAdmin(env, caller.email)) {
    const e = new Error('Only a System Admin can do that. Realm Admins are confined to their own realm.');
    e.forbidden = true;
    throw e;
  }
  return caller;
}

/** True when this caller is a System Admin (an ADMIN_EMAILS address). */
export function isSystemAdmin(env, caller) {
  return !!caller && caller.role === 'admin' && isConfiguredAdmin(env, caller.email);
}


/**
 * The realm whose data a caller sees.
 *
 * For everyone except a super admin this is their OWN realm, full stop — an
 * ordinary account cannot read outside the realm it belongs to. A super admin
 * (an ADMIN_EMAILS address) may additionally pick a realm to VIEW from the
 * Admin Panel; that choice is stored on their user row, not sent per request,
 * so it still cannot be forged by a client.
 *
 * The env argument is what makes the super-admin check possible. Call sites
 * that only ever act on the caller's own realm can use homeRealmOf instead.
 */
export function realmIdOf(caller, env) {
  if (!caller) return DEFAULT_REALM_ID;
  if (env && caller.activeRealm && isSystemAdmin(env, caller)) return caller.activeRealm;
  return caller.realmId || DEFAULT_REALM_ID;
}

/** The realm a caller BELONGS to, ignoring any admin view-switch. */
export function homeRealmOf(caller) {
  return (caller && caller.realmId) || DEFAULT_REALM_ID;
}

/**
 * WHO RUNS A SHOP — the owner, a MANAGER they appointed, or an admin.
 *
 * A manager acts as the owner in the day-to-day: the register's Buying side,
 * inventory, the roster, notices, the time card log, transfers, the coffer,
 * discounts. Their limit is not "less trusted with money" — it is that they
 * cannot change WHO HAS POWER or WHAT PEOPLE ARE PAID. Those are `requireOwner`
 * below, and they are deliberately a short list.
 *
 * This is a PREDICATE rather than a third role spelled out at each call site.
 * There were about forty `role !== 'owner' && role !== 'admin'` checks before
 * this, and adding a role to thirty-nine of them is how the fortieth becomes a
 * hole nobody notices.
 */
export function managesBusiness(caller) {
  return !!caller && (caller.role === 'owner' || caller.role === 'manager' || caller.role === 'admin');
}

/** Requires someone who runs the shop — owner, manager or admin. */
export async function requireManages(request, env) {
  const caller = await requireRegistered(request, env);
  if (!managesBusiness(caller)) {
    const e = new Error('Only a business owner, a manager or an admin can do that.');
    e.forbidden = true;
    throw e;
  }
  return caller;
}

/**
 * THE OWNER'S OWN — what a manager must not reach.
 *
 * Kept to the things that would let a manager rewrite the terms of their own
 * employment or hand the shop to someone else: appointing and removing
 * managers, setting pay and commission, reissuing the staff code, and taking
 * the shop's whole book away as a file. An admin still passes, because an admin
 * administers the realm and someone has to be able to act when an owner cannot.
 */
export async function requireOwner(request, env) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only the business owner or an admin can do that — a manager cannot.');
    e.forbidden = true;
    throw e;
  }
  return caller;
}

/** Requires a registered user whose account is active (can operate the register). */
export async function requireActive(request, env) {
  const user = await requireRegistered(request, env);
  if (user.status !== 'active') {
    const e = new Error('Your account is pending — an owner or admin must activate you before you can use the register.');
    e.forbidden = true;
    throw e;
  }
  return user;
}

/** Shapes a user record for the client (never leaks internals). */
export function publicUser(user, extra) {
  return {
    registered: true,
    uid: user.uid,
    email: user.email,
    character: user.character || '',
    business: user.business,
    role: user.role,
    isOwner: user.isOwner,
    status: user.status,
    ...(extra || {}),
  };
}

/** A short actor label for the audit trail. */
export function actorName(caller) {
  return (caller.character || caller.email || caller.uid) + (caller.business ? ' (' + caller.business + ')' : '');
}

/** Business meta helper re-exported so routes import guards, not registry directly. */
export { findBusinessMeta, markPriority };
