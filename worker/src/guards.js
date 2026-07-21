/**
 * Authorization guards — the enforcement side of the trust boundary. Every
 * protected route resolves the caller through one of these; they verify the
 * Google ID token and map it to a registry identity + role.
 */
import { verifyIdToken } from './verify.js';
import { findUserByEmail } from './users.js';
import { markPriority } from './ratelimit.js';
import { findBusinessMeta } from './registry.js';

/** Verifies the Bearer ID token on a request; returns the decoded payload or throws. */
export async function requireUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new Error('Missing bearer token.');
  return verifyIdToken(m[1], env.GOOGLE_CLIENT_ID);
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

/** Requires the caller to be a registered admin. */
export async function requireAdmin(request, env) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'admin') {
    const e = new Error('Admins only.');
    e.forbidden = true;
    throw e;
  }
  return caller;
}

/** Requires the caller to be an owner or admin; returns the caller record. */
export async function requireOwnerOrAdmin(request, env) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a business owner or an admin can do that.');
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
