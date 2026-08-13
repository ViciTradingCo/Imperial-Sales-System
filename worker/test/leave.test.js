/**
 * An employee leaving the shop they work for.
 *
 * The promise the feature makes is that GOING IS NOT FORFEITING: their shifts
 * and the sales they rang up carry the BUSINESS on the row, not a live link to
 * their account, so the shop keeps its history and keeps owing them whatever it
 * owed. That is the thing worth pinning down — along with the two people who
 * must not be able to use it, and the open shift that would otherwise be left
 * hanging with nobody able to close it.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { registerUser, findBusinessByName } from '../src/registry.js';
import { listUsersByBusiness, findUserByEmail, deleteMember } from '../src/users.js';
import { clockIn, clockOut, shopShifts, markPaid } from '../src/timecard.js';
import { leaveRefusal } from '../src/guards.js';

let env;
const R = DEFAULT_REALM_ID;
const SHOP = 'The Forge';

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run();
  await registerUser(env, { email: 'own@x.com', character: 'Marcus', businessName: SHOP, asOwner: true, realmId: R });
  await registerUser(env, { email: 'emp@x.com', character: 'Sera', businessName: SHOP, asOwner: false, realmId: R });
});

const sera = () => findUserByEmail(env, 'emp@x.com');
/** A finished, unpaid shift plus a sale carrying commission — money owed. */
async function earnSomething(uid) {
  await clockIn(env, { uid, employee: 'Sera', business: SHOP, rate: 5 }, R);
  await env.DB.prepare('UPDATE time_card SET clock_in = ? WHERE uid = ? AND clock_out IS NULL')
    .bind(new Date(Date.now() - 4 * 3600000).toISOString(), uid).run();
  await clockOut(env, { uid, rate: 5 }, R);
  await env.DB.prepare(
    `INSERT INTO sales (realm_id, business, ts, order_no, items, qty_total, total, employee, employee_uid, commission, status)
     VALUES (?, ?, ?, 'S-1', '', 1, 100, 'Sera', ?, 10, '')`)
    .bind(R, SHOP, new Date().toISOString(), uid).run();
}

describe('leaving', () => {
  it('takes them off the roster', async () => {
    const me = await sera();
    await deleteMember(env, me.uid, R);
    expect((await listUsersByBusiness(env, SHOP, R)).map((u) => u.character)).toEqual(['Marcus']);
  });

  it('unregisters them, so a staff code is the way back in', async () => {
    const me = await sera();
    await deleteMember(env, me.uid, R);
    expect(await findUserByEmail(env, 'emp@x.com')).toBe(null);
    // …and that really is a way back: registering again works.
    await registerUser(env, { email: 'emp@x.com', character: 'Sera', businessName: SHOP, asOwner: false, realmId: R });
    expect((await sera()).business).toBe(SHOP);
  });

  it('does NOT cancel what the shop owes them', async () => {
    const me = await sera();
    await earnSomething(me.uid);
    const before = (await shopShifts(env, SHOP, R)).people.find((p) => p.uid === me.uid);
    expect(before.owed).toBe(30); // 4h at 5 = 20, plus 10 commission

    await deleteMember(env, me.uid, R);

    const after = (await shopShifts(env, SHOP, R)).people.find((p) => p.uid === me.uid);
    expect(after, 'the debt must survive the person').toBeTruthy();
    expect(after.owed).toBe(30);
    expect(after.employee).toBe('Sera'); // still named, so an owner knows who
  });

  it('leaves the owner able to settle it afterwards', async () => {
    const me = await sera();
    await earnSomething(me.uid);
    await deleteMember(env, me.uid, R);
    const after = await markPaid(env, { business: SHOP, uid: me.uid }, R);
    expect(after.people.find((p) => p.uid === me.uid).owed).toBe(0);
  });

  it('leaves the shop’s sales history alone', async () => {
    const me = await sera();
    await earnSomething(me.uid);
    await deleteMember(env, me.uid, R);
    const row = await env.DB.prepare('SELECT employee, business FROM sales WHERE order_no = ?').bind('S-1').first();
    expect(row).toMatchObject({ employee: 'Sera', business: SHOP });
  });

  it('does not touch anybody else', async () => {
    const me = await sera();
    await deleteMember(env, me.uid, R);
    expect((await findUserByEmail(env, 'own@x.com')).business).toBe(SHOP);
    expect((await findBusinessByName(env, SHOP, R)).businessName).toBe(SHOP);
  });
});

/**
 * WHO MAY LEAVE. One predicate, used both by the route that refuses and by the
 * screen that decides whether to offer the button — so a screen can never
 * offer something the server will turn down.
 */
describe('who may leave', () => {
  const may = (u) => leaveRefusal(u) === '';

  it('lets an employee go', () => {
    expect(may({ role: 'employee', business: SHOP })).toBe(true);
  });

  it('lets a MANAGER go — they are an employee with more to do, not an owner', () => {
    expect(may({ role: 'manager', business: SHOP })).toBe(true);
  });

  it('refuses an owner, and says whose job it is instead', () => {
    expect(leaveRefusal({ role: 'owner', business: SHOP })).toMatch(/nobody running it/);
    // isOwner alone is enough — the flag is what several screens read.
    expect(may({ role: 'employee', isOwner: true, business: SHOP })).toBe(false);
  });

  it('refuses an admin, who was never in a shop', () => {
    expect(leaveRefusal({ role: 'admin' })).toMatch(/no shop to leave/);
  });

  it('refuses somebody with no shop at all', () => {
    expect(leaveRefusal({ role: 'employee', business: '' })).toMatch(/not part of a shop/);
  });

  it('refuses nobody at all rather than throwing', () => {
    expect(leaveRefusal(null)).toBeTruthy();
  });
});
