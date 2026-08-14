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

/** `from` is the region the goods came FROM — somebody there sold them. */
const intakeFrom = (qty, per, from) => env.DB.prepare(
  `INSERT INTO intake (realm_id, business, ts, item, source_hold, num_items, price_per)
   VALUES (?, 'Alpha', '2026-01-01T00:00:00Z', 'Iron Sword', ?, ?, ?)`).bind(R, from || '', qty, per).run();
const intake = (qty, per) => intakeFrom(qty, per, '');

const itemRow = async () => (await marketAnalysis(env, R)).items[0];

/** A transfer accepted from another company: goods in, paid for at its price. */
let transferNo = 0;
const transferIn = (qty, price, status) => env.DB.prepare(
  `INSERT INTO transfers (realm_id, from_business, to_business, item, qty, price, status, ts)
   VALUES (?, 'Rival Traders', 'Alpha', 'Iron Sword', ?, ?, ?, '2026-01-01T00:00:00Z')`)
  .bind(R, qty, price, status || 'accepted').run();

/**
 * Average value is what the item CHANGES HANDS FOR, over every transaction in
 * it — sales to customers, intake from vendors, transfers between companies.
 * A buy and a sale are both the item moving at a price, so both are evidence.
 *
 * It is a weighted MEDIAN with outliers fenced, not a mean: a realm's trade is
 * exactly where the one absurd deal happens.
 */
describe('average value', () => {
  it('weights by units, so a bulk deal outweighs a one-off', async () => {
    await sale([{ name: 'Iron Sword', qty: 10, price: 10 }]);
    await sale([{ name: 'Iron Sword', qty: 1, price: 100 }]);
    const i = await itemRow();
    expect(i.avgValue).toBe(10);          // where the units actually went
    expect(i.valueSamples).toBe(11);
  });

  it('fences off an outlier once there is a spread to measure', async () => {
    await sale([{ name: 'Iron Sword', qty: 5, price: 30 }]);
    await sale([{ name: 'Iron Sword', qty: 5, price: 31 }]);
    await sale([{ name: 'Iron Sword', qty: 5, price: 32 }]);
    await sale([{ name: 'Iron Sword', qty: 1, price: 5000 }]); // a collector
    expect((await itemRow()).avgValue).toBe(31);
  });

  it('holds the line on too few prices to fence, where the median alone must do', async () => {
    await sale([{ name: 'Iron Sword', qty: 1, price: 30 }]);
    await sale([{ name: 'Iron Sword', qty: 1, price: 40 }]);
    await sale([{ name: 'Iron Sword', qty: 1, price: 5000 }]);
    expect((await itemRow()).avgValue).toBe(40);
  });

  it('counts what shops PAID as well as what they charged', async () => {
    // Ten bought at 10 and one sold at 100: the item changes hands at 10.
    await intake(10, 10);
    await sale([{ name: 'Iron Sword', qty: 1, price: 100 }]);
    const i = await itemRow();
    expect(i.avgValue).toBe(10);
    expect(i.valueSamples).toBe(11);
  });

  it('values an item that has only ever been bought in', async () => {
    await intake(5, 20);
    const i = await itemRow();
    expect(i.avgValue).toBe(20);
    expect(i.valueSamples).toBe(5);
  });

  it('counts transfers between companies too', async () => {
    await transferIn(4, 25);
    expect((await itemRow()).avgValue).toBe(25);
  });

  it('ignores a transfer that was never accepted', async () => {
    await intake(2, 10);
    await transferIn(10, 999, 'pending');
    await transferIn(10, 999, 'declined');
    expect((await itemRow()).avgValue).toBe(10);
  });

  it('ignores a gift — a price of nothing is not a price', async () => {
    await intake(2, 10);
    await transferIn(50, 0);
    expect((await itemRow()).avgValue).toBe(10);
  });

  it('ignores voided sales', async () => {
    await sale([{ name: 'Iron Sword', qty: 1, price: 50 }]);
    await sale([{ name: 'Iron Sword', qty: 1, price: 999 }], 'VOIDED');
    expect((await itemRow()).avgValue).toBe(50);
  });

  it('skips intake rows with no quantity', async () => {
    await intake(0, 999);
    await intake(2, 10);
    expect((await itemRow()).avgValue).toBe(10);
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

  it('counts intake as trade in the region it came FROM', async () => {
    // Nobody sold this anywhere; a shop bought it from Markarth, which is
    // somebody in Markarth selling.
    await intakeFrom(6, 45, 'Markarth');
    const b = (await itemRow()).bestRegion;
    expect(b.region).toBe('Markarth');
    expect(b.value).toBe(45);
    expect(b.qty).toBe(6);
  });

  it('weighs a region\'s sales and its supply together', async () => {
    await saleIn('Whiterun', [{ name: 'Iron Sword', qty: 1, price: 60 }]);
    await intakeFrom(9, 10, 'Whiterun');
    // Nine units at 10 against one at 60: Whiterun trades this at 10.
    expect((await itemRow()).bestRegion).toMatchObject({ region: 'Whiterun', value: 10, qty: 10 });
  });
});

/**
 * A region's totals cover everything that changed hands there: sales rung up in
 * it, and intake sourced from it. Counting only the register's side would
 * credit a region for what it buys and nothing for what it supplies.
 */
describe('region totals', () => {
  const regionRow = async (name) => ((await marketAnalysis(env, R)).holds || []).find((h) => h.hold === name);

  it('adds intake sourced from a region to that region', async () => {
    await saleIn('Whiterun', [{ name: 'Iron Sword', qty: 2, price: 30 }]);   // 60 over 2, 1 order
    await intakeFrom(4, 10, 'Whiterun');                                     // 40 over 4, 1 order
    expect(await regionRow('Whiterun')).toEqual({ hold: 'Whiterun', orders: 2, items: 6, revenue: 100 });
  });

  it('lists a region that has only ever supplied', async () => {
    await intakeFrom(3, 20, 'Markarth');
    expect(await regionRow('Markarth')).toEqual({ hold: 'Markarth', orders: 1, items: 3, revenue: 60 });
  });

  it('does not invent a region for intake with no source recorded', async () => {
    await intake(5, 10);
    expect((await marketAnalysis(env, R)).holds).toEqual([]);
  });

  it('keeps the two regions of one intake apart from a sale elsewhere', async () => {
    await saleIn('The Rift', [{ name: 'Iron Sword', qty: 1, price: 50 }]);
    await intakeFrom(2, 15, 'Markarth');
    expect(await regionRow('The Rift')).toMatchObject({ revenue: 50 });
    expect(await regionRow('Markarth')).toMatchObject({ revenue: 30 });
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

/**
 * A harvest is logged as intake so it shows in the delivery history, but it is
 * the shop producing goods, not buying them. Once an owner sets a harvest rate
 * the row carries a non-zero price — a WAGE, deliberately under what the goods
 * fetch — and nothing here may read that as what the item is worth.
 */
describe('harvests', () => {
  const harvest = (qty, per) => env.DB.prepare(
    `INSERT INTO intake (realm_id, business, ts, item, vendor, source_hold, num_items, price_per)
     VALUES (?, 'Alpha', '2026-01-01T00:00:00Z', 'Iron Sword', 'Farm/Harvest', '', ?, ?)`)
    .bind(R, qty, per).run();

  it('do not drag the value down to what the shop pays its own people', async () => {
    await sale([{ name: 'Iron Sword', qty: 2, price: 40 }]);
    await harvest(50, 5);
    const i = await itemRow();
    expect(i.avgValue).toBe(40);
    expect(i.boughtQty).toBe(0);
  });

  it('leave an item out of the market entirely if that is all it ever had', async () => {
    await harvest(50, 5);
    expect((await marketAnalysis(env, R)).items).toEqual([]);
  });

  it('are not a cost the underpriced report may compare a shelf price against', async () => {
    await env.DB.prepare(
      `INSERT INTO inventory (realm_id, business, item, price, stock) VALUES (?, 'Alpha', 'Iron Sword', 20, 5)`)
      .bind(R).run();
    await harvest(50, 5);
    // A shelf price of 20 against a 5gp wage is a healthy margin, not a loss.
    expect((await marketAnalysis(env, R)).underpriced).toEqual([]);
    // …and a real delivery at 30 still flags it.
    await intake(10, 30);
    expect((await marketAnalysis(env, R)).underpriced.map((u) => u.item)).toEqual(['Iron Sword']);
  });

  it('still count as a purchase when they name a real vendor — the flag is the vendor', async () => {
    await intake(10, 30);
    const i = await itemRow();
    expect(i.boughtQty).toBe(10);
  });
});

/**
 * AN ARCHIVED SHOP has left the network. Its trade really happened, so it keeps
 * its line where the figures have to add up — but a ranking of who is doing
 * well is not somewhere a departed shop belongs, and the Top 5 reads this flag
 * to drop it.
 */
describe('archived companies', () => {
  const archive = (name) => env.DB.prepare(
    "INSERT INTO companies (id, business, status, realm_id) VALUES (?, ?, 'ARCHIVED', ?)")
    .bind('c-' + name, name, R).run();
  const live = (name) => env.DB.prepare(
    "INSERT INTO companies (id, business, status, realm_id) VALUES (?, ?, 'VALID', ?)")
    .bind('c-' + name, name, R).run();

  it('is flagged, so a ranking can leave it out', async () => {
    await archive('Alpha');
    await sale([{ name: 'Iron Sword', qty: 2, price: 40 }]);
    const row = (await marketAnalysis(env, R)).businesses.find((b) => b.business === 'Alpha');
    expect(row).toMatchObject({ archived: true, revenue: 80 });
  });

  it('KEEPS its figures — the trade happened and the totals must add up', async () => {
    await archive('Alpha');
    await sale([{ name: 'Iron Sword', qty: 2, price: 40 }]);
    expect((await marketAnalysis(env, R)).businesses.map((b) => b.business)).toContain('Alpha');
  });

  it('leaves a shop that is still trading unflagged', async () => {
    await live('Alpha');
    await sale([{ name: 'Iron Sword', qty: 1, price: 40 }]);
    const row = (await marketAnalysis(env, R)).businesses.find((b) => b.business === 'Alpha');
    expect(row.archived).toBe(false);
  });

  it('does not flag a shop merely because it is missing from the roster', async () => {
    // Renamed since, say. Unknown is not the same as departed.
    await sale([{ name: 'Iron Sword', qty: 1, price: 40 }]);
    const row = (await marketAnalysis(env, R)).businesses.find((b) => b.business === 'Alpha');
    expect(row.archived).toBe(false);
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
    expect(d.item.valueSamples).toBe(listed.valueSamples);
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
    const i = await itemRow();
    expect(i.avgValue).toBe(50);      // the other realm's 999 must not weigh in
    expect(i.valueSamples).toBe(1);
  });
});

/**
 * Company Performance covers the whole roster.
 *
 * Grouping sales by business answers "who traded", which leaves out the shops
 * an admin most needs to find: the one that opened last week and has sold
 * nothing, the one that has gone quiet. A missing row and a nonexistent shop
 * look identical; a row of zeroes does not.
 */
describe('company performance', () => {
  const register = (name, hold) => env.DB.prepare(
    `INSERT INTO companies (id, realm_id, business, hold, status) VALUES (?, ?, ?, ?, 'ACTIVE')`)
    .bind('co-' + name.toLowerCase().replace(/\W/g, ''), R, name, hold || '').run();

  it('lists a registered company that has never sold anything', async () => {
    await register('Alpha');
    await register('Quiet Forge');
    await sale([{ name: 'Iron Sword', qty: 2, price: 25 }]);   // Alpha only
    const rows = (await marketAnalysis(env, R)).businesses;
    expect(rows.map((b) => b.business)).toEqual(['Alpha', 'Quiet Forge']);
    expect(rows[1]).toEqual({ business: 'Quiet Forge', orders: 0, items: 0, revenue: 0, archived: false });
  });

  it('ranks by revenue, then alphabetically among the silent', async () => {
    await register('Zebra Goods');
    await register('Alpha');
    await register('Middle Rest');
    await sale([{ name: 'Iron Sword', qty: 2, price: 25 }]);
    const rows = (await marketAnalysis(env, R)).businesses;
    expect(rows.map((b) => b.business)).toEqual(['Alpha', 'Middle Rest', 'Zebra Goods']);
  });

  it('keeps a business that traded but is no longer on the roster', async () => {
    // Archived or renamed since: the trade still happened, and dropping it
    // would leave the realm's totals unexplainable.
    await sale([{ name: 'Iron Sword', qty: 2, price: 25 }]);
    const rows = (await marketAnalysis(env, R)).businesses;
    expect(rows.map((b) => b.business)).toEqual(['Alpha']);
    expect(rows[0].revenue).toBe(50);
  });

  it('leaves out another realm\'s companies', async () => {
    await register('Alpha');
    await env.DB.prepare(
      `INSERT INTO companies (id, realm_id, business, hold, status) VALUES ('co-other', ?, 'Other Realm Shop', '', 'ACTIVE')`)
      .bind('rlm-market-b').run();
    const rows = (await marketAnalysis(env, R)).businesses;
    expect(rows.map((b) => b.business)).toEqual(['Alpha']);
  });

  it('leaves out an archived company', async () => {
    await register('Alpha');
    await env.DB.prepare(
      `INSERT INTO companies (id, realm_id, business, hold, status) VALUES ('co-gone', ?, 'Shuttered', '', 'ARCHIVED')`)
      .bind(R).run();
    const rows = (await marketAnalysis(env, R)).businesses;
    expect(rows.map((b) => b.business)).toEqual(['Alpha']);
  });

  it('counts neither voided sales nor employee purchases toward a shop', async () => {
    await register('Alpha');
    await sale([{ name: 'Iron Sword', qty: 2, price: 25 }], 'VOIDED');
    await staffSale([{ name: 'Iron Sword', qty: 3, price: 25 }]);
    const rows = (await marketAnalysis(env, R)).businesses;
    expect(rows).toEqual([{ business: 'Alpha', orders: 0, items: 0, revenue: 0, archived: false }]);
  });
});
