/**
 * The recent-errors buffer, and who may clear it.
 *
 * The buffer is deployment-wide — errors belong to the Worker, not to a realm —
 * which makes clearing it the one place this feature could cross realms. It
 * must not: a Realm Admin's clear may only drop entries stamped with their own
 * realm.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema } from '../src/db.js';
import { recordError, recentErrors, clearErrors } from '../src/status.js';

let env;
const A = 'rlm-a';
const B = 'rlm-b';

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM sys_flags').run();
  await recordError(env, 'checkout', 'boom in A', A);
  await recordError(env, 'checkout', 'boom in B', B);
  await recordError(env, 'auth', 'boom before sign-in');   // no realm: the deployment's own
});

describe('recording', () => {
  it('keeps errors newest first, stamped with their realm', async () => {
    const list = await recentErrors(env);
    expect(list).toHaveLength(3);
    expect(list[0].message).toBe('boom before sign-in');
    expect(list[0].realmId).toBeNull();
    expect(list[2].realmId).toBe(A);
  });
});

describe('clearing', () => {
  it('empties the buffer for a System Admin (no realm scope)', async () => {
    const res = await clearErrors(env);
    expect(res.cleared).toBe(3);
    expect(res.errors).toEqual([]);
    expect(await recentErrors(env)).toEqual([]);
  });

  it('drops only the calling realm\'s entries for a Realm Admin', async () => {
    const res = await clearErrors(env, A);
    expect(res.cleared).toBe(1);
    const left = await recentErrors(env);
    expect(left.map((e) => e.message)).toEqual(['boom before sign-in', 'boom in B']);
  });

  it('leaves the deployment\'s own unstamped errors to a System Admin', async () => {
    await clearErrors(env, A);
    await clearErrors(env, B);
    // Neither realm admin can reach the pre-sign-in error.
    expect((await recentErrors(env)).map((e) => e.message)).toEqual(['boom before sign-in']);
  });

  it('reports nothing cleared when the realm has no errors', async () => {
    const res = await clearErrors(env, 'rlm-quiet');
    expect(res.cleared).toBe(0);
    expect(await recentErrors(env)).toHaveLength(3);
  });
});
