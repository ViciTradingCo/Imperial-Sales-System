/**
 * Sessions — staying signed in for a day.
 *
 * THE PROBLEM. A Google ID token expires after an hour and cannot be extended;
 * renewing one means going back to Google, which only works silently while the
 * browser still has its Google session and the page is still alive. Neither
 * survives a phone putting a tab to sleep. So the app kept "logging people out",
 * because the only credential it had was one it could not keep.
 *
 * THE FIX. Google proves WHO you are, once. We then mint a credential of our
 * own, valid for 24 hours, and the app uses that from then on. Sign-in still
 * goes through Google; nothing else does.
 *
 * WHY NOT A COOKIE. The site is on github.io and this API is on workers.dev, so
 * a session cookie would be a third-party cookie: it needs SameSite=None, which
 * Safari blocks outright and Chrome restricts. It would work for some users and
 * silently fail for others — the worst possible failure mode for a login. The
 * token goes in localStorage and rides the Authorization header instead, which
 * behaves identically on every browser and is the same credential either way.
 *
 * WHAT IS STORED. Only the SHA-256 of the token, so this table cannot be read
 * and replayed. The row carries an email, not a role or a realm: authorization
 * is re-read from the user row on every single request, exactly as it was when
 * the Google token was the credential. Deleting or demoting someone therefore
 * takes effect at once — their session keeps proving who they are, and who they
 * are no longer gets them in.
 */
import { getDb } from './db.js';

/** How long a session lasts. Absolute, not sliding — a day means a day. */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Marks our tokens so a Google JWT is never mistaken for one, and vice versa.
 * A JWT is three dot-separated base64 segments; this is deliberately not that.
 */
export const SESSION_PREFIX = 'vs1.';

/** True if this bearer token is one of ours rather than Google's. */
export function isSessionToken(raw) {
  return String(raw || '').startsWith(SESSION_PREFIX);
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SHA-256, hex. What we store in place of the token itself. */
async function hash(raw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Issues a session for a verified Google identity.
 *
 * `uid` is optional: someone who has signed in with Google but not yet
 * registered still needs a session to complete registration with, and they have
 * no user row until they do. The email is what every later lookup uses.
 */
export async function createSession(env, { email, name, uid }) {
  const addr = String(email || '').trim().toLowerCase();
  if (!addr) throw new Error('Cannot create a session without an email.');
  const raw = SESSION_PREFIX + b64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  const expires = new Date(now + SESSION_TTL_MS).toISOString();
  const db = await getDb(env);
  await db.prepare(
    'INSERT INTO sessions (id, uid, email, name, created, expires, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(await hash(raw), uid || '', addr, name || '', new Date(now).toISOString(), expires, new Date(now).toISOString()).run();
  return { token: raw, expires };
}

/**
 * Resolves a session token to the identity it proves, or null if it is unknown
 * or expired. Shaped like a verified Google payload so callers cannot tell the
 * two credentials apart.
 */
export async function resolveSession(env, raw) {
  if (!isSessionToken(raw)) return null;
  const db = await getDb(env);
  const row = await db.prepare('SELECT uid, email, name, expires FROM sessions WHERE id = ?')
    .bind(await hash(raw)).first();
  if (!row) return null;
  if (new Date(row.expires).getTime() <= Date.now()) return null;
  return { email: row.email, name: row.name || '', uid: row.uid || '', expires: row.expires };
}

/** Ends one session — what Sign Out does. Unknown tokens are a no-op. */
export async function revokeSession(env, raw) {
  if (!isSessionToken(raw)) return;
  const db = await getDb(env);
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(await hash(raw)).run();
}

/**
 * Ends every session belonging to an address. Used when an account is deleted:
 * their sessions would stop working anyway (the user row is gone, so there is
 * nobody to authorize), but leaving rows behind for an account that no longer
 * exists is not something to rely on going unnoticed.
 */
export async function revokeSessionsFor(env, email) {
  const addr = String(email || '').trim().toLowerCase();
  if (!addr) return;
  const db = await getDb(env);
  await db.prepare('DELETE FROM sessions WHERE email = ?').bind(addr).run();
}

/** Clears expired rows. Called from the daily cron; nothing depends on it. */
export async function purgeExpiredSessions(env) {
  const db = await getDb(env);
  const res = await db.prepare('DELETE FROM sessions WHERE expires <= ?')
    .bind(new Date().toISOString()).run();
  // D1 reports row counts under meta; the test shim (node:sqlite) reports them
  // at the top level.
  return (res && ((res.meta && res.meta.changes) || res.changes)) || 0;
}
