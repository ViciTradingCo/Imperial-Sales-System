/**
 * Time cards.
 *
 * The rules that matter are about MONEY and about double-counting:
 *   • nobody can hold two open shifts, or every hour between them counts twice;
 *   • a finished shift keeps the rate it was stamped with, so a raise never
 *     restates what past work was worth;
 *   • marking paid moves no coin — it records that a person handed it over;
 *   • an open shift is worth nothing yet, because it is still being worked.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import {
  clockIn, clockOut, openShift, myShifts, shopShifts, markPaid, editShift, deleteShift, hoursBetween,
} from '../src/timecard.js';
import { cofferBalance } from '../src/coffers.js';

let env;
const R = DEFAULT_REALM_ID;
const OTHER = 'rlm-tc-b';
const SHOP = 'Iron Hearth';
const ANN = { uid: 'u-ann', employee: 'Ann', business: SHOP };

/** Backdates the open shift so a measurable number of hours has "passed". */
const startedHoursAgo = async (uid, hours) => {
  const at = new Date(Date.now() - hours * 3600000).toISOString();
  await env.DB.prepare('UPDATE time_card SET clock_in = ? WHERE uid = ? AND clock_out IS NULL')
    .bind(at, uid).run();
};

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => { for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run(); });

describe('clocking on and off', () => {
  it('opens a shift and reports it', async () => {
    const open = await clockIn(env, { ...ANN, rate: 5 }, R);
    expect(open).toMatchObject({ uid: 'u-ann', employee: 'Ann', open: true });
    expect(await openShift(env, 'u-ann', R)).not.toBe(null);
  });

  it('refuses a second open shift', async () => {
    // Two would double-count every hour between them; the usual cause is a
    // double-tap on the button.
    await clockIn(env, { ...ANN, rate: 5 }, R);
    await expect(clockIn(env, { ...ANN, rate: 5 }, R)).rejects.toThrow(/already clocked in/i);
  });

  it('refuses to clock out when not clocked in', async () => {
    await expect(clockOut(env, { uid: 'u-ann', rate: 5 }, R)).rejects.toThrow(/not clocked in/i);
  });

  it('closes the shift and works out the pay', async () => {
    await clockIn(env, { ...ANN, rate: 5 }, R);
    await startedHoursAgo('u-ann', 4);
    const done = await clockOut(env, { uid: 'u-ann', rate: 5 }, R);
    expect(done.open).toBe(false);
    expect(done.hours).toBeCloseTo(4, 1);
    expect(done.pay).toBe(20);
  });

  it('lets the same person work another shift afterwards', async () => {
    await clockIn(env, { ...ANN, rate: 5 }, R);
    await clockOut(env, { uid: 'u-ann', rate: 5 }, R);
    await clockIn(env, { ...ANN, rate: 5 }, R);
    expect((await myShifts(env, 'u-ann', R))).toHaveLength(2);
  });

  it('pays in whole coins, rounded down like every other amount', async () => {
    await clockIn(env, { ...ANN, rate: 3 }, R);
    await startedHoursAgo('u-ann', 2.5);   // 7.5 at 3/hour
    const done = await clockOut(env, { uid: 'u-ann', rate: 3 }, R);
    expect(done.pay).toBe(7);
  });

  it('an OPEN shift is worth nothing yet', async () => {
    // A figure that ticks upward invites clocking out to make it stop.
    await clockIn(env, { ...ANN, rate: 5 }, R);
    await startedHoursAgo('u-ann', 3);
    expect((await openShift(env, 'u-ann', R)).pay).toBe(0);
  });

  it('flags a shift long enough to be a forgotten clock-out', async () => {
    await clockIn(env, { ...ANN, rate: 5 }, R);
    await startedHoursAgo('u-ann', 30);
    expect((await openShift(env, 'u-ann', R)).long).toBe(true);
  });
});

describe('the rate a shift is worth', () => {
  it('is the one it was stamped with, not the one in force later', async () => {
    // The whole reason the rate lives on the row: a raise must not silently
    // restate what last month's unpaid work was worth.
    await clockIn(env, { ...ANN, rate: 5 }, R);
    await startedHoursAgo('u-ann', 2);
    await clockOut(env, { uid: 'u-ann', rate: 5 }, R);

    await clockIn(env, { ...ANN, rate: 20 }, R);          // a raise
    await startedHoursAgo('u-ann', 1);
    await clockOut(env, { uid: 'u-ann', rate: 20 }, R);

    const log = await shopShifts(env, SHOP, R);
    expect(log.people[0].owed).toBe(10 + 20);             // 2h@5 + 1h@20
  });
});

describe('the owner\'s log', () => {
  const BEX = { uid: 'u-bex', employee: 'Bex', business: SHOP };

  it('totals hours and what is owed, per person', async () => {
    await clockIn(env, { ...ANN, rate: 5 }, R);
    await startedHoursAgo('u-ann', 4);
    await clockOut(env, { uid: 'u-ann', rate: 5 }, R);
    await clockIn(env, { ...BEX, rate: 10 }, R);
    await startedHoursAgo('u-bex', 2);
    await clockOut(env, { uid: 'u-bex', rate: 10 }, R);

    const log = await shopShifts(env, SHOP, R);
    expect(log.totals.owed).toBe(40);                     // 20 + 20
    expect(log.people.map((p) => p.employee).sort()).toEqual(['Ann', 'Bex']);
  });

  it('does not count an open shift toward hours or wages', async () => {
    await clockIn(env, { ...ANN, rate: 5 }, R);
    await startedHoursAgo('u-ann', 4);
    const log = await shopShifts(env, SHOP, R);
    expect(log.totals.owed).toBe(0);
    expect(log.totals.hours).toBe(0);
    expect(log.totals.open).toBe(1);
    expect(log.people[0].open).toBe(true);
  });

  it('sees only its own shop', async () => {
    await clockIn(env, { ...ANN, rate: 5 }, R);
    await clockOut(env, { uid: 'u-ann', rate: 5 }, R);
    await clockIn(env, { uid: 'u-zed', employee: 'Zed', business: 'Rift Traders', rate: 5 }, R);
    await clockOut(env, { uid: 'u-zed', rate: 5 }, R);
    const log = await shopShifts(env, SHOP, R);
    expect(log.shifts.every((s) => s.employee === 'Ann')).toBe(true);
  });

  it('sees only its own realm', async () => {
    await clockIn(env, { ...ANN, rate: 5 }, OTHER);
    expect((await shopShifts(env, SHOP, R)).shifts).toEqual([]);
    expect((await shopShifts(env, SHOP, OTHER)).shifts).toHaveLength(1);
  });
});

describe('settling wages', () => {
  it('marks a person\'s shifts paid and clears what is owed', async () => {
    await clockIn(env, { ...ANN, rate: 5 }, R);
    await startedHoursAgo('u-ann', 4);
    await clockOut(env, { uid: 'u-ann', rate: 5 }, R);
    const after = await markPaid(env, { business: SHOP, uid: 'u-ann' }, R);
    expect(after.totals.owed).toBe(0);
    expect(after.shifts[0].paid).toBe(true);
  });

  it('MOVES NO MONEY — it records that someone paid', async () => {
    // Same rule as the Court's levy. A shop's coffer is its own to spend.
    await clockIn(env, { ...ANN, rate: 5 }, R);
    await startedHoursAgo('u-ann', 4);
    await clockOut(env, { uid: 'u-ann', rate: 5 }, R);
    await markPaid(env, { business: SHOP, uid: 'u-ann' }, R);
    expect(await cofferBalance(env, SHOP, R)).toBe(0);
    const { results } = await env.DB.prepare('SELECT id FROM coffer_entries').all();
    expect(results).toHaveLength(0);
  });

  it('never marks an OPEN shift paid', async () => {
    await clockIn(env, { ...ANN, rate: 5 }, R);
    await markPaid(env, { business: SHOP, uid: 'u-ann' }, R);
    expect((await openShift(env, 'u-ann', R)).paid).toBe(false);
  });

  it('refuses to pay nobody in particular', async () => {
    await expect(markPaid(env, { business: SHOP }, R)).rejects.toThrow(/which employee/i);
  });
});

describe('correcting a shift', () => {
  it('fixes a forgotten clock-out', async () => {
    await clockIn(env, { ...ANN, rate: 5 }, R);
    await startedHoursAgo('u-ann', 30);
    await clockOut(env, { uid: 'u-ann', rate: 5 }, R);
    const id = (await myShifts(env, 'u-ann', R))[0].id;
    const end = new Date(Date.now() - 26 * 3600000).toISOString();
    const after = await editShift(env, { business: SHOP, id, clockOut: end }, R);
    expect(after.shifts[0].hours).toBeCloseTo(4, 1);
  });

  it('reopens a shift when the end time is cleared', async () => {
    // The right answer when someone clocked out by accident and is still working.
    await clockIn(env, { ...ANN, rate: 5 }, R);
    await clockOut(env, { uid: 'u-ann', rate: 5 }, R);
    const id = (await myShifts(env, 'u-ann', R))[0].id;
    await editShift(env, { business: SHOP, id, clockOut: '' }, R);
    expect(await openShift(env, 'u-ann', R)).not.toBe(null);
  });

  it('refuses an end before the start', async () => {
    await clockIn(env, { ...ANN, rate: 5 }, R);
    await clockOut(env, { uid: 'u-ann', rate: 5 }, R);
    const id = (await myShifts(env, 'u-ann', R))[0].id;
    await expect(editShift(env, { business: SHOP, id, clockOut: '2000-01-01T00:00:00Z' }, R))
      .rejects.toThrow(/end after it starts/i);
  });

  it('cannot touch another shop\'s shift', async () => {
    await clockIn(env, { ...ANN, rate: 5 }, R);
    await clockOut(env, { uid: 'u-ann', rate: 5 }, R);
    const id = (await myShifts(env, 'u-ann', R))[0].id;
    await expect(editShift(env, { business: 'Rift Traders', id, note: 'x' }, R)).rejects.toThrow(/not on this shop/i);
    await expect(deleteShift(env, { business: 'Rift Traders', id }, R)).rejects.toThrow(/not on this shop/i);
  });

  it('deletes a shift recorded by mistake', async () => {
    await clockIn(env, { ...ANN, rate: 5 }, R);
    await clockOut(env, { uid: 'u-ann', rate: 5 }, R);
    const id = (await myShifts(env, 'u-ann', R))[0].id;
    const after = await deleteShift(env, { business: SHOP, id }, R);
    expect(after.shifts).toEqual([]);
  });
});

describe('hoursBetween', () => {
  it('is zero for a backwards or unusable pair', () => {
    expect(hoursBetween('2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z')).toBe(0);
    expect(hoursBetween('nonsense', '2026-01-01T00:00:00Z')).toBe(0);
    expect(hoursBetween('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')).toBe(0);
  });
});
