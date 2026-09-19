/**
 * CLOCKING SOMEBODY ELSE ON AND OFF.
 *
 * The person who worked the shift is not always the person at the screen, so
 * an owner or a manager can work the shop's clock on their behalf. What has to
 * be true of that:
 *
 *   • THE RATE IS THE WORKER'S. Reading `caller.payRate` would pay every
 *     employee whatever the owner earns — a bug that pays out silently, long
 *     before anybody reads the code. This is the assertion that matters most
 *     here and it is made from both directions.
 *   • It is the same clock, not a second one: a shift opened by the owner is
 *     the shift the employee sees, and either of them can close it.
 *   • An owner or a manager may; an employee may not touch anyone's clock but
 *     their own, and nobody reaches another shop's roster.
 *   • Two open shifts for one person are impossible however they are opened,
 *     since every hour between them would be counted twice.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { ensureDefaultRealm } from '../src/realm.js';
import { registerUser } from '../src/registry.js';
import { findUserByEmail, setManagerRole, appendUser, setPayRate, setUserStatus } from '../src/users.js';
import { createSession } from '../src/sessions.js';
import { openShift, myShifts, clockOut } from '../src/timecard.js';
import { routes as businessRoutes } from '../src/routes/business.js';
import { cacheBust } from '../src/cache.js';

let env;
const R = DEFAULT_REALM_ID;
const SHOP = 'The Forge';
const RIVAL = 'Riverwood Trader';

const req = (token) => ({ headers: { get: (h) => (h === 'Authorization' ? 'Bearer ' + token : null) } });
const route = (method, path) => businessRoutes.find((r) => r.method === method && r.path === path);
const call = (method, path, token, body) => route(method, path).handler({
  request: req(token), env, body: body || {}, url: new URL('https://x' + path),
});
const clockOn = (token, uid) => call('POST', '/timecard/staff/in', token, { uid });
const clockOff = (token, uid, note) => call('POST', '/timecard/staff/out', token, { uid, note });
const log = (token) => call('GET', '/timecard/log', token);

let token = {};
let uid = {};

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of [...REALM_TABLES, 'realms', 'sessions']) await env.DB.prepare('DELETE FROM ' + t).run();
  cacheBust('');
  await ensureDefaultRealm(env);

  await registerUser(env, { email: 'own@x.test', character: 'Marcus', businessName: SHOP, asOwner: true, realmId: R });
  await registerUser(env, { email: 'emp@x.test', character: 'Sera', businessName: SHOP, asOwner: false, realmId: R });
  const foreman = await appendUser(env, { uid: 'u-foreman', email: 'mgr@x.test', character: 'Vilkas',
    business: SHOP, role: 'employee', isOwner: false, status: 'active', realmId: R });
  await setManagerRole(env, foreman.uid, true);
  // Registered but not yet activated — cannot work the register, so cannot be
  // put on the clock either.
  await appendUser(env, { uid: 'u-new', email: 'new@x.test', character: 'Lydia',
    business: SHOP, role: 'employee', isOwner: false, status: 'pending', realmId: R });
  await registerUser(env, { email: 'rival@x.test', character: 'Lucan', businessName: RIVAL, asOwner: true, realmId: R });
  await registerUser(env, { email: 'hand@x.test', character: 'Camilla', businessName: RIVAL, asOwner: false, realmId: R });

  const at = async (email) => (await findUserByEmail(env, email)).uid;
  uid = {
    owner: await at('own@x.test'), employee: await at('emp@x.test'),
    manager: await at('mgr@x.test'), pending: await at('new@x.test'),
    stranger: await at('hand@x.test'),
  };
  // Deliberately different figures, so a rate taken from the wrong person is
  // an obvious number rather than a coincidence.
  await setPayRate(env, uid.owner, 50, R);
  await setPayRate(env, uid.employee, 5, R);
  await setPayRate(env, uid.manager, 8, R);
  await setUserStatus(env, uid.employee, 'active', R);

  const session = async (email) => (await createSession(env, { email })).token;
  token = {
    owner: await session('own@x.test'), manager: await session('mgr@x.test'),
    employee: await session('emp@x.test'), rival: await session('rival@x.test'),
  };
});

/** Drags an open shift back in time so closing it produces real hours. */
const backdate = (who, hours) => env.DB.prepare(
  'UPDATE time_card SET clock_in = ? WHERE uid = ? AND clock_out IS NULL')
  .bind(new Date(Date.now() - hours * 3600000).toISOString(), who).run();

describe('clocking someone in', () => {
  it('opens a shift for THEM, not for the person pressing the button', async () => {
    await clockOn(token.owner, uid.employee);
    expect(await openShift(env, uid.employee, R)).toBeTruthy();
    expect(await openShift(env, uid.owner, R)).toBe(null);
  });

  it('names them on the shift, so the log reads as theirs', async () => {
    await clockOn(token.owner, uid.employee);
    expect((await openShift(env, uid.employee, R)).employee).toBe('Sera');
  });

  it('refuses a second one — every hour between two would count twice', async () => {
    await clockOn(token.owner, uid.employee);
    await expect(clockOn(token.owner, uid.employee)).rejects.toThrow(/already clocked in/i);
  });

  it('will not put a pending account on the clock', async () => {
    await expect(clockOn(token.owner, uid.pending)).rejects.toThrow(/not active/i);
    expect(await openShift(env, uid.pending, R)).toBe(null);
  });

  it('records who did it, so an hour on somebody’s pay is never anonymous', async () => {
    await clockOn(token.owner, uid.employee);
    const row = await env.DB.prepare("SELECT actor, detail FROM audit WHERE action = 'timecard.clockIn'").first();
    expect(row.actor).toContain('Marcus');
    expect(row.detail).toContain('Sera');
  });
});

/**
 * THE ONE THAT PAYS OUT IF IT IS WRONG. The rate stamped on a shift is what the
 * shop will owe for it, and the obvious mistake — using the rate of whoever is
 * holding the screen — would quietly pay an employee the owner's wage.
 */
describe('whose rate gets stamped', () => {
  it('is the worker’s, when the owner clocks them out', async () => {
    await clockOn(token.owner, uid.employee);
    await backdate(uid.employee, 4);
    await clockOff(token.owner, uid.employee);
    const [shift] = await myShifts(env, uid.employee, R);
    expect(shift.rate).toBe(5);        // Sera's, not Marcus's 50
    expect(shift.pay).toBe(20);        // four hours at 5
  });

  it('is the worker’s when a manager does it too', async () => {
    await clockOn(token.manager, uid.employee);
    await backdate(uid.employee, 2);
    await clockOff(token.manager, uid.employee);
    const [shift] = await myShifts(env, uid.employee, R);
    expect(shift.rate).toBe(5);        // not the manager's 8
    expect(shift.pay).toBe(10);
  });

  /**
   * From the other direction, so the test cannot pass by both people happening
   * to earn the same: the owner clocked out by a manager keeps the OWNER'S rate.
   */
  it('is not the caller’s, clocking the owner out', async () => {
    await clockOn(token.manager, uid.owner);
    await backdate(uid.owner, 1);
    await clockOff(token.manager, uid.owner);
    const [shift] = await myShifts(env, uid.owner, R);
    expect(shift.rate).toBe(50);
    expect(shift.pay).toBe(50);
  });

  /**
   * The rate is read at clock-OUT, the same rule the self route follows: a
   * correction made during the shift applies to the shift it corrects.
   */
  it('follows a correction made while the shift was running', async () => {
    await clockOn(token.owner, uid.employee);
    await backdate(uid.employee, 2);
    await setPayRate(env, uid.employee, 9, R);
    await clockOff(token.owner, uid.employee);
    expect((await myShifts(env, uid.employee, R))[0].rate).toBe(9);
  });
});

describe('clocking someone out', () => {
  it('closes the shift and leaves nothing open', async () => {
    await clockOn(token.owner, uid.employee);
    await clockOff(token.owner, uid.employee);
    expect(await openShift(env, uid.employee, R)).toBe(null);
  });

  it('refuses when they are not on the clock', async () => {
    await expect(clockOff(token.owner, uid.employee)).rejects.toThrow(/not clocked in/i);
  });

  it('keeps the note, on the shift they will read later', async () => {
    await clockOn(token.owner, uid.employee);
    await clockOff(token.owner, uid.employee, 'Sent home early — quiet day.');
    expect((await myShifts(env, uid.employee, R))[0].note).toBe('Sent home early — quiet day.');
  });

  it('records who did it', async () => {
    await clockOn(token.owner, uid.employee);
    await clockOff(token.owner, uid.employee);
    const row = await env.DB.prepare("SELECT actor, detail FROM audit WHERE action = 'timecard.clockOut'").first();
    expect(row.actor).toContain('Marcus');
    expect(row.detail).toContain('Sera');
  });
});

/**
 * ONE CLOCK, not two. A shift the owner opened is the employee's own shift —
 * it is on their card, and they can close it themselves.
 */
describe('it is the same clock', () => {
  it('a shift the owner opened is the one the employee sees and can close', async () => {
    await clockOn(token.owner, uid.employee);
    const mine = await call('GET', '/timecard', token.employee);
    expect(mine.open).toBeTruthy();
    await clockOut(env, { uid: uid.employee, rate: 5, note: '' }, R);   // their own button
    expect(await openShift(env, uid.employee, R)).toBe(null);
  });

  it('and one the employee opened can be closed by the owner', async () => {
    await call('POST', '/timecard/in', token.employee);
    await backdate(uid.employee, 3);
    await clockOff(token.owner, uid.employee);
    const [shift] = await myShifts(env, uid.employee, R);
    expect(shift.open).toBe(false);
    expect(shift.pay).toBe(15);
  });
});

describe('who may work the shop’s clock', () => {
  it('the owner may', async () => {
    expect((await clockOn(token.owner, uid.employee)).staff.length).toBeGreaterThan(0);
  });

  /**
   * A manager may, and deliberately: they can ALREADY edit and delete any shift
   * on this log, so refusing them the smaller act would be a rule that reads
   * like an oversight. What stays the owner's is the RATE, not the clock.
   */
  it('a manager may — they already edit and delete shifts here', async () => {
    await clockOn(token.manager, uid.employee);
    expect(await openShift(env, uid.employee, R)).toBeTruthy();
  });

  it('an ordinary employee may not touch anyone’s clock but their own', async () => {
    await expect(clockOn(token.employee, uid.manager)).rejects.toThrow(/owner|manager|admin/i);
    await expect(clockOff(token.employee, uid.manager)).rejects.toThrow(/owner|manager|admin/i);
    expect(await openShift(env, uid.manager, R)).toBe(null);
  });

  it('reaches nobody on another shop’s roster', async () => {
    await expect(clockOn(token.owner, uid.stranger)).rejects.toThrow(/not part of your business/i);
    expect(await openShift(env, uid.stranger, R)).toBe(null);
  });

  it('and a rival owner cannot reach into this one', async () => {
    await expect(clockOn(token.rival, uid.employee)).rejects.toThrow(/not part of your business/i);
  });
});

/**
 * The roster travels with the log for one reason: the person an owner most
 * needs to clock in is the one who has never clocked in, and a list built from
 * shift rows is exactly the list they are missing from.
 */
describe('the log carries the roster', () => {
  it('lists every ACTIVE member, including those who have never worked a shift', async () => {
    const d = await log(token.owner);
    const names = d.staff.map((s) => s.employee).sort();
    expect(names).toEqual(['Marcus', 'Sera', 'Vilkas']);   // Lydia is pending
    expect(d.people.length).toBe(0);                       // nobody has any hours yet
  });

  it('says who is on shift and since when', async () => {
    await clockOn(token.owner, uid.employee);
    const sera = (await log(token.owner)).staff.find((s) => s.employee === 'Sera');
    expect(sera.onShift).toBe(true);
    expect(sera.since).toBeTruthy();
    const marcus = (await log(token.owner)).staff.find((s) => s.employee === 'Marcus');
    expect(marcus.onShift).toBe(false);
  });

  it('comes back from the act itself, so the screen never re-asks', async () => {
    const after = await clockOn(token.owner, uid.employee);
    expect(after.staff.find((s) => s.employee === 'Sera').onShift).toBe(true);
    const off = await clockOff(token.owner, uid.employee);
    expect(off.staff.find((s) => s.employee === 'Sera').onShift).toBe(false);
  });
});
