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
import { marketAnalysis } from '../src/market.js';
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
const sale = (lines, status) => env.DB.prepare(
  `INSERT INTO sales (realm_id, business, ts, order_no, items, qty_total, total, status)
   VALUES (?, 'Alpha', '2026-01-01T00:00:00Z', ?, ?, ?, ?, ?)`)
  .bind(R, 'S-' + (++orderNo), encodeSaleItems(lines), lines.reduce((n, l) => n + l.qty, 0),
    lines.reduce((n, l) => n + l.qty * l.price, 0), status || 'OK').run();

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
