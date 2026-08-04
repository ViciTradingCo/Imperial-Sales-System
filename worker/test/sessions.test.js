/**
 * Sessions — the 24-hour credential that replaced re-signing-in every hour.
 *
 * What has to hold, and why each one matters:
 *   • the raw token is never stored, so this table cannot be replayed;
 *   • tokens are unguessable and unique per sign-in;
 *   • an expired session is refused, without waiting for a cron to notice;
 *   • signing out kills the token everywhere, not just in the browser that had it;
 *   • deleting a member kills theirs;
 *   • a session proves IDENTITY only — role, realm and status are still read
 *     from the user row, so yesterday's session cannot outrank today's account.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema } from '../src/db.js';
import {
  SESSION_TTL_MS, SESSION_PREFIX, isSessionToken,
  createSession, resolveSession, revokeSession, revokeSessionsFor, purgeExpiredSessions,
} from '../src/sessions.js';
import { requireUser, requireRegistered, requireAdmin } from '../src/guards.js';
import { deleteMember } from '../src/users.js';

let env;
const ANN = { email: 'ann@x.test', name: 'Ann', uid: 'u-ann' };

/** A request carrying a bearer credential, as the Worker would receive it. */
function req(token) {
  return { headers: { get: (h) => (h === 'Authorization' && token ? 'Bearer ' + token : null) } };
}

async function seedUser(row) {
  await env.DB.prepare(
    'INSERT INTO users (uid, realm_id, email, business, role, is_owner, status, char_name, created) ' +
    "VALUES (?, 'default', ?, ?, ?, ?, 'active', ?, ?)"
  ).bind(row.uid, row.email, row.business || 'Iron Hearth', row.role || 'employee',
    row.role === 'owner' ? 1 : 0, row.character || '', new Date().toISOString()).run();
}

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '', GOOGLE_CLIENT_ID: 'test.apps' }; await ensureSchema(env); });
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM sessions').run();
  await env.DB.prepare('DELETE FROM users').run();
});

describe('issuing', () => {
  it('returns a prefixed token and an expiry a day out', async () => {
    const { token, expires } = await createSession(env, ANN);
    expect(isSessionToken(token)).toBe(true);
    expect(token.startsWith(SESSION_PREFIX)).toBe(true);
    const life = new Date(expires).getTime() - Date.now();
    expect(life).toBeGreaterThan(SESSION_TTL_MS - 60_000);
    expect(life).toBeLessThanOrEqual(SESSION_TTL_MS);
  });

  it('never stores the token itself', async () => {
    const { token } = await createSession(env, ANN);
    const { results } = await env.DB.prepare('SELECT id FROM sessions').all();
    expect(results).toHaveLength(1);
    expect(results[0].id).not.toContain(token);
    expect(results[0].id).toMatch(/^[0-9a-f]{64}$/); // a SHA-256, not a secret
  });

  it('issues a different token every time', async () => {
    const seen = new Set();
    for (let i = 0; i < 5; i++) seen.add((await createSession(env, ANN)).token);
    expect(seen.size).toBe(5);
  });

  it('issues to someone who has not registered yet', async () => {
    // Signing up takes several screens; making them do it on an expiring
    // credential is how registration used to die halfway through.
    const { token } = await createSession(env, { email: 'new@x.test', name: 'New' });
    expect((await resolveSession(env, token)).email).toBe('new@x.test');
  });

  it('lowercases the email so a session cannot dodge a lookup by casing', async () => {
    const { token } = await createSession(env, { email: 'Ann@X.test', name: 'Ann' });
    expect((await resolveSession(env, token)).email).toBe('ann@x.test');
  });

  it('refuses to mint a session with no email', async () => {
    await expect(createSession(env, { name: 'Nobody' })).rejects.toThrow(/email/i);
  });
});

describe('resolving', () => {
  it('returns the identity it proves', async () => {
    const { token } = await createSession(env, ANN);
    const s = await resolveSession(env, token);
    expect(s.email).toBe('ann@x.test');
    expect(s.name).toBe('Ann');
  });

  it('rejects an unknown token', async () => {
    expect(await resolveSession(env, SESSION_PREFIX + 'not-a-real-token')).toBe(null);
  });

  it('rejects an altered token', async () => {
    const { token } = await createSession(env, ANN);
    expect(await resolveSession(env, token.slice(0, -1) + 'X')).toBe(null);
  });

  it('rejects anything that is not one of ours', async () => {
    expect(await resolveSession(env, 'eyJhbGciOiJSUzI1NiJ9.e30.sig')).toBe(null);
    expect(await resolveSession(env, '')).toBe(null);
  });

  it('rejects an expired session on sight, before any purge runs', async () => {
    const { token } = await createSession(env, ANN);
    await env.DB.prepare('UPDATE sessions SET expires = ?')
      .bind(new Date(Date.now() - 1000).toISOString()).run();
    expect(await resolveSession(env, token)).toBe(null);
    // Still in the table — refusal does not depend on housekeeping having run.
    const { results } = await env.DB.prepare('SELECT id FROM sessions').all();
    expect(results).toHaveLength(1);
  });
});

describe('ending a session', () => {
  it('sign-out kills the token everywhere, not just in one browser', async () => {
    const { token } = await createSession(env, ANN);
    await revokeSession(env, token);
    expect(await resolveSession(env, token)).toBe(null);
  });

  it('signing out of one device leaves the others signed in', async () => {
    const phone = await createSession(env, ANN);
    const desk = await createSession(env, ANN);
    await revokeSession(env, phone.token);
    expect(await resolveSession(env, phone.token)).toBe(null);
    expect((await resolveSession(env, desk.token)).email).toBe('ann@x.test');
  });

  it('deleting a member ends every session they had', async () => {
    await seedUser({ uid: 'u-ann', email: 'ann@x.test', role: 'employee' });
    const a = await createSession(env, ANN);
    const b = await createSession(env, ANN);
    await deleteMember(env, 'u-ann', 'default');
    expect(await resolveSession(env, a.token)).toBe(null);
    expect(await resolveSession(env, b.token)).toBe(null);
  });

  it('revoking by address leaves other people alone', async () => {
    const ann = await createSession(env, ANN);
    const bex = await createSession(env, { email: 'bex@x.test', name: 'Bex' });
    await revokeSessionsFor(env, 'ANN@X.TEST'); // casing must not matter
    expect(await resolveSession(env, ann.token)).toBe(null);
    expect((await resolveSession(env, bex.token)).email).toBe('bex@x.test');
  });

  it('purges only what has expired', async () => {
    const live = await createSession(env, ANN);
    const dead = await createSession(env, { email: 'old@x.test' });
    await env.DB.prepare('UPDATE sessions SET expires = ? WHERE email = ?')
      .bind(new Date(Date.now() - 1000).toISOString(), 'old@x.test').run();
    expect(await purgeExpiredSessions(env)).toBe(1);
    expect((await resolveSession(env, live.token)).email).toBe('ann@x.test');
    expect(await resolveSession(env, dead.token)).toBe(null);
  });
});

describe('as a credential on a request', () => {
  it('a session token gets through requireUser without going to Google', async () => {
    const { token } = await createSession(env, ANN);
    const payload = await requireUser(req(token), env);
    expect(payload.email).toBe('ann@x.test');
  });

  it('an expired session says so, and the message maps to a 401', async () => {
    const { token } = await createSession(env, ANN);
    await env.DB.prepare('UPDATE sessions SET expires = ?')
      .bind(new Date(Date.now() - 1000).toISOString()).run();
    await expect(requireUser(req(token), env)).rejects.toThrow(/expired/i);
  });

  it('no credential at all is refused', async () => {
    await expect(requireUser(req(null), env)).rejects.toThrow(/bearer/i);
  });

  it('resolves to the account as it is NOW, not as it was at sign-in', async () => {
    // The whole safety argument for a day-long token: it proves identity, and
    // authorization is re-read every request. A demotion has to bite at once.
    await seedUser({ uid: 'u-ann', email: 'ann@x.test', role: 'admin' });
    const { token } = await createSession(env, ANN);
    expect((await requireAdmin(req(token), env)).role).toBe('admin');

    await env.DB.prepare("UPDATE users SET role = 'employee' WHERE uid = 'u-ann'").run();
    const { bustUserCache } = await import('../src/users.js');
    bustUserCache();
    await expect(requireAdmin(req(token), env)).rejects.toThrow(/admin/i);
  });

  it('stops working the moment the account is deleted', async () => {
    await seedUser({ uid: 'u-ann', email: 'ann@x.test', role: 'owner' });
    const { token } = await createSession(env, ANN);
    expect((await requireRegistered(req(token), env)).uid).toBe('u-ann');
    await deleteMember(env, 'u-ann', 'default');
    await expect(requireRegistered(req(token), env)).rejects.toThrow();
  });
});
