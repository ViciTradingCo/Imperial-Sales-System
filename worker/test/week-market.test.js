/**
 * Market Info — a shop's view of its region, one week behind.
 *
 * Two things to hold. The WINDOW: it covers the week that has finished, so the
 * figures change once when Monday arrives and hold still for seven days. And
 * the CONTENT: it is the same report the Court reads, so a shop and its Court
 * cannot end up with different accounts of the same week.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { holdReport } from '../src/market.js';
import { lastWeekWindow, weekStart, isWeekTurnover } from '../src/week.js';
import { importItemIndex } from '../src/item-index.js';
import { encodeSaleItems } from '../src/sales.js';

let env;
const R = DEFAULT_REALM_ID;
const HOLD = 'Whiterun';

let orderNo = 0;
const saleOn = (ts, business, lines) => env.DB.prepare(
  `INSERT INTO sales (realm_id, business, ts, order_no, hold, items, qty_total, total, status)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OK')`)
  .bind(R, business, ts, 'S-' + (++orderNo), HOLD, encodeSaleItems(lines),
    lines.reduce((n, l) => n + l.qty, 0),
    lines.reduce((n, l) => n + l.qty * l.price, 0)).run();
const intakeOn = (ts, qty, per, from) => env.DB.prepare(
  `INSERT INTO intake (realm_id, business, ts, item, source_hold, num_items, price_per, from_business)
   VALUES (?, 'Buyer', ?, 'Iron Sword', ?, ?, ?, ?)`).bind(R, ts, HOLD, qty, per, from || '').run();

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run();
  await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 30 }], R);
});

/**
 * Weeks run Monday 00:00 UTC to Monday 00:00 UTC. 2026-08-05 is a Wednesday,
 * so the week just gone is Mon 27 July → Mon 3 August.
 */
describe('which week it covers', () => {
  it('is the last COMPLETE week, Monday to Monday', () => {
    const w = lastWeekWindow(new Date('2026-08-05T14:30:00Z')); // a Wednesday
    expect(w.from).toBe('2026-07-27T00:00:00.000Z');
    expect(w.to).toBe('2026-08-03T00:00:00.000Z');
  });

  it('holds still all week, then moves once', () => {
    // Every day from Monday to Sunday reports the same seven days…
    const week = lastWeekWindow(new Date('2026-08-03T00:00:00Z'));   // Monday
    for (const day of ['2026-08-04', '2026-08-05', '2026-08-08', '2026-08-09']) {
      expect(lastWeekWindow(new Date(day + 'T23:59:59Z'))).toEqual(week);
    }
    // …and the next Monday it steps forward exactly seven days.
    const next = lastWeekWindow(new Date('2026-08-10T00:00:00Z'));
    expect(next.from).toBe(week.to);
    expect(new Date(next.to) - new Date(next.from)).toBe(7 * 86400000);
  });

  it('treats Sunday as the end of the week, not the start', () => {
    // The boundary worth pinning: late Sunday is still the old week, and one
    // second later is the new one.
    const sunday = lastWeekWindow(new Date('2026-08-09T23:59:59Z'));
    const monday = lastWeekWindow(new Date('2026-08-10T00:00:00Z'));
    expect(sunday.from).toBe('2026-07-27T00:00:00.000Z');
    expect(monday.from).toBe('2026-08-03T00:00:00.000Z');
  });

  it('covers every moment exactly once across consecutive weeks', () => {
    // Half-open [from, to): the boundary instant belongs to the later week only.
    const a = lastWeekWindow(new Date('2026-08-05T00:00:00Z'));
    const b = lastWeekWindow(new Date('2026-08-12T00:00:00Z'));
    expect(a.to).toBe(b.from);
  });
});

/**
 * ONE boundary for everything weekly. There used to be two — the market window
 * rolled on Monday, the backup reminder fired on Sunday — so the "end of the
 * week" nudge arrived a full day before the week's figures settled.
 */
describe('every weekly thing turns over together', () => {
  it('the reminder fires on the day the market window rolls', () => {
    const monday = new Date('2026-08-10T09:00:00Z');
    expect(isWeekTurnover(monday)).toBe(true);
    // The window it rolled to begins exactly where the previous week's ended.
    expect(lastWeekWindow(monday).to).toBe(weekStart(monday).toISOString());
  });

  it('does not fire on any other day of the week', () => {
    for (const day of ['2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16']) {
      expect(isWeekTurnover(new Date(day + 'T12:00:00Z')), day).toBe(false);
    }
  });

  it('no longer fires on Sunday, a day before the figures settle', () => {
    expect(isWeekTurnover(new Date('2026-08-09T12:00:00Z'))).toBe(false);
  });

  it('the window and the reminder cannot disagree — both read weekStart', () => {
    // Across a whole week, the reminder is true on exactly the day the window
    // last changed. Anything else means two definitions have crept back in.
    const days = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
      '2026-08-14', '2026-08-15', '2026-08-16'];
    const firing = days.filter((d) => isWeekTurnover(new Date(d + 'T12:00:00Z')));
    expect(firing).toEqual(['2026-08-10']);
    const start = weekStart(new Date('2026-08-10T12:00:00Z')).toISOString();
    days.forEach((d) => {
      expect(weekStart(new Date(d + 'T12:00:00Z')).toISOString(), d).toBe(start);
    });
  });
});

describe('what falls inside it', () => {
  const WEEK = { from: '2026-07-27T00:00:00.000Z', to: '2026-08-03T00:00:00.000Z' };

  it('counts a sale inside the week and ignores ones outside it', async () => {
    await saleOn('2026-07-28T10:00:00Z', 'Alpha', [{ name: 'Iron Sword', qty: 2, price: 25 }]);  // in
    await saleOn('2026-07-26T10:00:00Z', 'Alpha', [{ name: 'Iron Sword', qty: 9, price: 25 }]);  // the week before
    await saleOn('2026-08-04T10:00:00Z', 'Alpha', [{ name: 'Iron Sword', qty: 9, price: 25 }]);  // this week
    const d = await holdReport(env, HOLD, R, WEEK);
    expect(d.overview.revenue).toBe(50);
    expect(d.businesses).toEqual([{ business: 'Alpha', orders: 1, items: 2, revenue: 50 }]);
  });

  it('includes the first instant and excludes the last', async () => {
    await saleOn('2026-07-27T00:00:00Z', 'Alpha', [{ name: 'Iron Sword', qty: 1, price: 10 }]);
    await saleOn('2026-08-03T00:00:00Z', 'Beta', [{ name: 'Iron Sword', qty: 1, price: 99 }]);
    const d = await holdReport(env, HOLD, R, WEEK);
    expect(d.businesses.map((b) => b.business)).toEqual(['Alpha']);
    expect(d.overview.revenue).toBe(10);
  });

  it('windows the supply side too', async () => {
    await intakeOn('2026-07-28T00:00:00Z', 4, 25, 'Forge');   // in
    await intakeOn('2026-08-04T00:00:00Z', 4, 25, 'Forge');   // this week
    const d = await holdReport(env, HOLD, R, WEEK);
    expect(d.overview.revenue).toBe(100);
    expect(d.businesses).toEqual([{ business: 'Forge', orders: 1, items: 4, revenue: 100 }]);
  });

  it('windows the unregistered bucket too', async () => {
    await intakeOn('2026-07-28T00:00:00Z', 4, 25, '');   // in
    await intakeOn('2026-08-04T00:00:00Z', 8, 25, '');   // this week
    const d = await holdReport(env, HOLD, R, WEEK);
    expect(d.unregistered).toEqual({ orders: 1, items: 4, revenue: 100 });
  });

  it('windows the item list too', async () => {
    await saleOn('2026-07-28T10:00:00Z', 'Alpha', [{ name: 'Iron Sword', qty: 2, price: 25 }]);
    await saleOn('2026-08-04T10:00:00Z', 'Alpha', [{ name: 'Iron Sword', qty: 40, price: 25 }]);
    const d = await holdReport(env, HOLD, R, WEEK);
    expect(d.items).toHaveLength(1);
    expect(d.items[0].qty).toBe(2);
  });

  it('reports a week nothing happened in as empty, not as everything', async () => {
    // The failure that matters: a window quietly not applied reads as a full
    // history, and nobody notices because the numbers look plausible.
    await saleOn('2026-08-04T10:00:00Z', 'Alpha', [{ name: 'Iron Sword', qty: 5, price: 25 }]);
    const d = await holdReport(env, HOLD, R, WEEK);
    expect(d.overview.revenue).toBe(0);
    expect(d.businesses).toEqual([]);
    expect(d.items).toEqual([]);
  });
});

describe('the same report the Court reads', () => {
  it('matches the unwindowed report when the window covers everything', async () => {
    await saleOn('2026-07-28T10:00:00Z', 'Alpha', [{ name: 'Iron Sword', qty: 2, price: 25 }]);
    await intakeOn('2026-07-29T00:00:00Z', 4, 25, 'Forge');
    await intakeOn('2026-07-29T00:00:00Z', 2, 10, '');
    const windowed = await holdReport(env, HOLD, R, { from: '2026-07-27T00:00:00.000Z', to: '2026-08-03T00:00:00.000Z' });
    const live = await holdReport(env, HOLD, R);
    expect(windowed).toEqual(live);
  });

  it('is unchanged for a Court when no window is given', async () => {
    await saleOn('2026-08-04T10:00:00Z', 'Alpha', [{ name: 'Iron Sword', qty: 5, price: 25 }]);
    const live = await holdReport(env, HOLD, R);
    expect(live.overview.revenue).toBe(125);
  });
});
