/**
 * Item Performance's price columns.
 *
 * The point of these is that they are QUANTITY-WEIGHTED: one sale of ten at 10
 * and one of one at 100 is not an average of 55, which is what a mean over
 * order rows would give.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { marketAnalysis, itemReport } from '../src/market.js';
import { importItemIndex } from '../src/item-index.js';
import { encodeSaleItems } from '../src/sales.js';

let env;
const R = DEFAULT_REALM_ID;

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run();
  await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 30 }], R);
});

let orderNo = 0;
/** A sale on a given day, in a given region — the three axes these tests vary. */
const saleAt = (day, region, lines, status) => env.DB.prepare(
  `INSERT INTO sales (realm_id, business, ts, order_no, hold, items, qty_total, total, status)
   VALUES (?, 'Alpha', ?, ?, ?, ?, ?, ?, ?)`)
  .bind(R, day + 'T00:00:00Z', 'S-' + (++orderNo), region, encodeSaleItems(lines),
    lines.reduce((n, l) => n + l.qty, 0),
    lines.reduce((n, l) => n + l.qty * l.price, 0), status || 'OK').run();
const sale = (lines, status) => saleAt('2026-01-01', '', lines, status);
/** Stock left the shelf, nothing was charged — must count nowhere. */
const staffSale = (lines) => env.DB.prepare(
  `INSERT INTO sales (realm_id, business, ts, order_no, items, qty_total, total, status, staff_purchase)
   VALUES (?, 'Alpha', '2026-01-01T00:00:00Z', ?, ?, ?, 0, 'OK', 1)`)
  .bind(R, 'S-' + (++orderNo), encodeSaleItems(lines), lines.reduce((n, l) => n + l.qty, 0)).run();
const saleOn = (day, lines) => saleAt(day, '', lines);
const saleIn = (region, lines) => saleAt('2026-01-01', region, lines);

const intake = (qty, per) => env.DB.prepare(
  `INSERT INTO intake (realm_id, business, ts, item, num_items, price_per)
   VALUES (?, 'Alpha', '2026-01-01T00:00:00Z', 'Iron Sword', ?, ?)`).bind(R, qty, per).run();

const itemRow = async () => (await marketAnalysis(env, R)).items[0];

describe('average sold', () => {
  it('weights by quantity, not by order', async () => {
    await sale([{ name: 'Iron Sword', qty: 10, price: 10 }]);
    await sale([{ name: 'Iron Sword', qty: 1, price: 100 }]);
    const i = await itemRow();
    expect(i.qty).toBe(11);
    expect(i.avgSold).toBeCloseTo(200 / 11);  // not 55
  });

  it('is null, not zero, when nothing has sold', async () => {
    await intake(5, 20);
    expect((await itemRow()).avgSold).toBeNull();
  });

  it('ignores voided sales', async () => {
    await sale([{ name: 'Iron Sword', qty: 1, price: 50 }]);
    await sale([{ name: 'Iron Sword', qty: 1, price: 999 }], 'VOIDED');
    expect((await itemRow()).avgSold).toBe(50);
  });
});

/** A transfer accepted from another company: goods in, paid for at its price. */
let transferNo = 0;
const transferIn = (qty, price, status) => env.DB.prepare(
  `INSERT INTO transfers (realm_id, from_business, to_business, item, qty, price, status, ts)
   VALUES (?, 'Rival Traders', 'Alpha', 'Iron Sword', ?, ?, ?, '2026-01-01T00:00:00Z')`)
  .bind(R, qty, price, status || 'accepted').run();

describe('average bought', () => {
  it('weights intake by quantity', async () => {
    await intake(10, 5);
    await intake(1, 60);
    const i = await itemRow();
    expect(i.avgBought).toBeCloseTo(110 / 11);
  });

  it('is null when the item was never bought in', async () => {
    await sale([{ name: 'Iron Sword', qty: 1, price: 50 }]);
    expect((await itemRow()).avgBought).toBeNull();
  });

  it('skips intake rows with no quantity', async () => {
    await intake(0, 999);
    await intake(2, 10);
    expect((await itemRow()).avgBought).toBe(10);
  });

  it('counts stock taken in from another company — that is buying too', async () => {
    await transferIn(4, 25);
    expect((await itemRow()).avgBought).toBe(25);
  });

  it('weights intake and transfers together', async () => {
    await intake(3, 10);       // 30 over 3
    await transferIn(1, 50);   // 50 over 1
    expect((await itemRow()).avgBought).toBe(80 / 4);
  });

  it('ignores a transfer that was never accepted', async () => {
    await intake(2, 10);
    await transferIn(10, 999, 'pending');
    await transferIn(10, 999, 'declined');
    expect((await itemRow()).avgBought).toBe(10);
  });

  it('ignores a gifted transfer — a price of nothing is not a purchase', async () => {
    await intake(2, 10);
    await transferIn(50, 0);
    expect((await itemRow()).avgBought).toBe(10);
  });

  it('does not read another realm\'s transfers', async () => {
    await intake(2, 10);
    await env.DB.prepare(
      `INSERT INTO transfers (realm_id, from_business, to_business, item, qty, price, status, ts)
       VALUES ('rlm-other', 'X', 'Alpha', 'Iron Sword', 99, 999, 'accepted', '2026-01-01T00:00:00Z')`).run();
    expect((await itemRow()).avgBought).toBe(10);
  });
});

/**
 * The valuation is a SALES analysis: the weighted median of what the item
 * actually sold at, with outliers fenced off. Not the mean, and not blended
 * with what shops paid suppliers.
 */
describe('average value', () => {
  it('is the weighted median, so one dear sale does not become the value', async () => {
    await sale([{ name: 'Iron Sword', qty: 10, price: 10 }]);
    await sale([{ name: 'Iron Sword', qty: 1, price: 100 }]);
    const i = await itemRow();
    expect(i.avgValue).toBe(10);              // where the units actually went
    expect(i.avgSold).toBeCloseTo(200 / 11);  // the mean is dragged upward
  });

  it('fences off an outlier once there is a spread to measure', async () => {
    await sale([{ name: 'Iron Sword', qty: 5, price: 30 }]);
    await sale([{ name: 'Iron Sword', qty: 5, price: 31 }]);
    await sale([{ name: 'Iron Sword', qty: 5, price: 32 }]);
    await sale([{ name: 'Iron Sword', qty: 1, price: 5000 }]); // a collector
    const i = await itemRow();
    expect(i.avgValue).toBe(31);
    expect(i.avgSold).toBeGreaterThan(300);   // the mean is useless here
  });

  it('holds the line on too few prices to fence, where the median alone must do', async () => {
    await sale([{ name: 'Iron Sword', qty: 1, price: 30 }]);
    await sale([{ name: 'Iron Sword', qty: 1, price: 40 }]);
    await sale([{ name: 'Iron Sword', qty: 1, price: 5000 }]);
    expect((await itemRow()).avgValue).toBe(40);
  });

  it('ignores intake — what a shop paid a supplier is cost, not value', async () => {
    await intake(100, 999);
    await sale([{ name: 'Iron Sword', qty: 2, price: 40 }]);
    const i = await itemRow();
    expect(i.avgValue).toBe(40);
    expect(i.avgBought).toBe(999);
  });

  it('is null when the item has only ever been bought in, never sold', async () => {
    await intake(5, 20);
    const i = await itemRow();
    expect(i.avgValue).toBeNull();
    expect(i.valueSamples).toBe(0);
  });

  it('reports how many units the valuation rests on', async () => {
    await sale([{ name: 'Iron Sword', qty: 7, price: 40 }]);
    expect((await itemRow()).valueSamples).toBe(7);
  });

  it('lists nothing for an indexed item with no trade at all', async () => {
    expect((await marketAnalysis(env, R)).items).toEqual([]);
  });
});

describe('the per-item trend', () => {
  it('is a daily series, oldest first, for the top items only', async () => {
    await saleOn('2026-01-02', [{ name: 'Iron Sword', qty: 2, price: 10 }]);
    await saleOn('2026-01-01', [{ name: 'Iron Sword', qty: 5, price: 10 }]);
    await saleOn('2026-01-02', [{ name: 'Iron Sword', qty: 1, price: 10 }]);
    const d = await marketAnalysis(env, R);
    expect(d.topItems[0].trend).toEqual([
      { day: '2026-01-01', qty: 5, revenue: 50, orders: 1 },
      { day: '2026-01-02', qty: 3, revenue: 30, orders: 2 },
    ]);
    // The full list carries the figures but not the series — it would dwarf them.
    expect(d.items[0].trend).toBeUndefined();
    expect(d.items[0].qty).toBe(8);
  });

  it('is empty for an item bought in but never sold', async () => {
    await intake(5, 20);
    const d = await marketAnalysis(env, R);
    expect(d.topItems[0].trend).toEqual([]);
  });
});

/**
 * Best region means where the item is WORTH most — the region with the highest
 * average value, measured the same way the realm-wide valuation is. Not where
 * the most of it moved.
 */
describe('best region', () => {
  it('is the region with the highest average value, not the busiest', async () => {
    await saleIn('The Rift', [{ name: 'Iron Sword', qty: 20, price: 10 }]);   // busy, cheap
    await saleIn('Whiterun', [{ name: 'Iron Sword', qty: 3, price: 45 }]);    // quiet, dear
    const b = (await itemRow()).bestRegion;
    expect(b.region).toBe('Whiterun');
    expect(b.value).toBe(45);
    expect(b.qty).toBe(3);
  });

  it('resists an outlier the same way the realm-wide value does', async () => {
    // Whiterun's one absurd sale must not make it the best region.
    await saleIn('Whiterun', [{ name: 'Iron Sword', qty: 5, price: 10 }]);
    await saleIn('Whiterun', [{ name: 'Iron Sword', qty: 5, price: 11 }]);
    await saleIn('Whiterun', [{ name: 'Iron Sword', qty: 5, price: 12 }]);
    await saleIn('Whiterun', [{ name: 'Iron Sword', qty: 1, price: 9000 }]);
    await saleIn('The Rift', [{ name: 'Iron Sword', qty: 4, price: 40 }]);
    expect((await itemRow()).bestRegion.region).toBe('The Rift');
  });

  it('breaks a tie on volume — the busier market of two paying the same', async () => {
    await saleIn('Whiterun', [{ name: 'Iron Sword', qty: 2, price: 30 }]);
    await saleIn('The Rift', [{ name: 'Iron Sword', qty: 9, price: 30 }]);
    expect((await itemRow()).bestRegion.region).toBe('The Rift');
  });

  it('is null when no sale recorded a region', async () => {
    await sale([{ name: 'Iron Sword', qty: 1, price: 10 }]);
    expect((await itemRow()).bestRegion).toBeNull();
  });
});

describe('employee purchases', () => {
  it('count nowhere — not in volume, value, or takings', async () => {
    await sale([{ name: 'Iron Sword', qty: 2, price: 40 }]);
    await staffSale([{ name: 'Iron Sword', qty: 8, price: 40 }]);
    const i = await itemRow();
    expect(i.qty).toBe(2);              // the 8 taken by staff are not sales
    expect(i.avgValue).toBe(40);        // and cannot drag the value toward 0
    expect(i.revenue).toBe(80);
  });

  it('leave an item out of the market entirely if that is all it ever had', async () => {
    await staffSale([{ name: 'Iron Sword', qty: 5, price: 40 }]);
    expect((await marketAnalysis(env, R)).items).toEqual([]);
  });

  it('are excluded from the shop and region breakdowns too', async () => {
    await staffSale([{ name: 'Iron Sword', qty: 5, price: 40 }]);
    const d = await marketAnalysis(env, R);
    expect(d.businesses).toEqual([]);
    expect(d.trends).toEqual([]);
  });
});

describe('one item on demand', () => {
  it('returns the same figures as the list, plus the trend', async () => {
    await saleOn('2026-01-01', [{ name: 'Iron Sword', qty: 4, price: 25 }]);
    await intake(2, 10);
    const d = await itemReport(env, 'Iron Sword', R);
    const listed = (await marketAnalysis(env, R)).items[0];
    expect(d.item.qty).toBe(listed.qty);
    expect(d.item.avgValue).toBe(listed.avgValue);
    expect(d.item.avgBought).toBe(listed.avgBought);
    expect(d.item.trend).toEqual([{ day: '2026-01-01', qty: 4, revenue: 100, orders: 1 }]);
    expect(d.baseValue).toBe(30);
  });

  it('resolves a name loosely, the way the index does', async () => {
    await sale([{ name: 'Iron Sword', qty: 1, price: 10 }]);
    expect((await itemReport(env, '  iron   SWORD ', R)).item.item).toBe('Iron Sword');
  });

  it('answers with zeroes for an indexed item that has never traded', async () => {
    const d = await itemReport(env, 'Iron Sword', R);
    expect(d.item).toMatchObject({ item: 'Iron Sword', qty: 0, avgValue: null, bestRegion: null, trend: [] });
  });

  it('refuses an item that is not in this realm\'s index', async () => {
    await expect(itemReport(env, 'Dragonbone Warhammer', R)).rejects.toThrow(/no item called/i);
    await expect(itemReport(env, '', R)).rejects.toThrow(/which item/i);
  });

  it('cannot read another realm\'s trade for the same item', async () => {
    await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 30 }], 'rlm-other');
    await sale([{ name: 'Iron Sword', qty: 3, price: 10 }]); // realm R only
    expect((await itemReport(env, 'Iron Sword', 'rlm-other')).item.qty).toBe(0);
    expect((await itemReport(env, 'Iron Sword', R)).item.qty).toBe(3);
  });
});

describe('scope', () => {
  it('leaves off-index items out of the market entirely', async () => {
    await sale([{ name: 'Unknown Relic', qty: 1, price: 500 }]);
    expect((await marketAnalysis(env, R)).items).toEqual([]);
  });

  it('does not read another realm\'s intake', async () => {
    await sale([{ name: 'Iron Sword', qty: 1, price: 50 }]);
    await env.DB.prepare(
      `INSERT INTO intake (realm_id, business, ts, item, num_items, price_per)
       VALUES ('rlm-other', 'Alpha', '2026-01-01T00:00:00Z', 'Iron Sword', 5, 999)`).run();
    expect((await itemRow()).avgBought).toBeNull();
  });
});
