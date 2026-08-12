/**
 * The MANAGER role.
 *
 * A manager is an employee an owner appointed to run the shop. They do
 * everything the owner does day to day; what they cannot do is change WHO HAS
 * POWER or WHAT PEOPLE ARE PAID.
 *
 * The value of these tests is the boundary, not the happy path. The whole
 * reason the role goes through one predicate rather than a third name at forty
 * call sites is that a role added to thirty-nine of them leaves the fortieth as
 * a hole nobody notices — so what is asserted here is that the two gates
 * disagree in exactly one direction, and that the escalation paths are shut.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { managesBusiness } from '../src/guards.js';
import { appendUser, setManagerRole, findUserByUid, setPayRate } from '../src/users.js';

let env;
const R = DEFAULT_REALM_ID;
const SHOP = 'Iron Hearth';

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => { for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run(); });

const add = (uid, role) => appendUser(env, {
  uid, email: uid + '@x.com', business: SHOP, role, isOwner: role === 'owner', status: 'active', character: uid, realmId: R,
});

describe('who runs a shop', () => {
  it('admits the owner, a manager and an admin', () => {
    for (const role of ['owner', 'manager', 'admin']) {
      expect(managesBusiness({ role }), role).toBe(true);
    }
  });

  it('refuses an ordinary employee, and anyone at all', () => {
    expect(managesBusiness({ role: 'employee' })).toBe(false);
    expect(managesBusiness(null)).toBe(false);
    expect(managesBusiness({})).toBe(false);
  });
});

describe('appointing a manager', () => {
  it('promotes an employee and stands them back down', async () => {
    await add('u-emp', 'employee');
    expect(await setManagerRole(env, 'u-emp', true, R)).toBe('manager');
    expect((await findUserByUid(env, 'u-emp', R)).role).toBe('manager');
    expect(await setManagerRole(env, 'u-emp', false, R)).toBe('employee');
    expect((await findUserByUid(env, 'u-emp', R)).role).toBe('employee');
  });

  it('leaves is_owner alone — a manager is not an owner', async () => {
    await add('u-emp', 'employee');
    await setManagerRole(env, 'u-emp', true, R);
    expect((await findUserByUid(env, 'u-emp', R)).isOwner).toBe(false);
  });

  it('cannot reach down and rewrite an owner or an admin', async () => {
    await add('u-own', 'owner');
    await add('u-adm', 'admin');
    await expect(setManagerRole(env, 'u-own', true, R)).rejects.toThrow(/Only an employee/);
    await expect(setManagerRole(env, 'u-adm', true, R)).rejects.toThrow(/Only an employee/);
  });

  it('cannot reach into another realm', async () => {
    await add('u-emp', 'employee');
    await expect(setManagerRole(env, 'u-emp', true, 'rlm-elsewhere')).rejects.toThrow(/not found/i);
  });
});

describe('what someone is paid', () => {
  it('sets an hourly rate and a commission independently', async () => {
    await add('u-emp', 'employee');
    expect(await setPayRate(env, 'u-emp', 5, R, 10)).toEqual({ rate: 5, commissionRate: 10 });
    const u = await findUserByUid(env, 'u-emp', R);
    expect(u.payRate).toBe(5);
    expect(u.commissionRate).toBe(10);
  });

  it('leaves a commission alone when only the hourly rate is sent', async () => {
    await add('u-emp', 'employee');
    await setPayRate(env, 'u-emp', 5, R, 10);
    await setPayRate(env, 'u-emp', 8, R);           // a screen that knows nothing of commission
    expect((await findUserByUid(env, 'u-emp', R)).commissionRate).toBe(10);
  });

  it('refuses a commission over 100% rather than quietly clamping it', async () => {
    await add('u-emp', 'employee');
    await expect(setPayRate(env, 'u-emp', 0, R, 120)).rejects.toThrow(/more than 100/);
  });

  it('refuses negative figures on either half', async () => {
    await add('u-emp', 'employee');
    await expect(setPayRate(env, 'u-emp', -1, R)).rejects.toThrow(/≥ 0/);
    await expect(setPayRate(env, 'u-emp', 0, R, -5)).rejects.toThrow(/≥ 0/);
  });
});
