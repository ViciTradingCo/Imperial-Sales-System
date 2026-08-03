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

describe('average value', () => {
  it('is both sides together, weighted by quantity', async () => {
    await intake(3, 10);                                    // 30 over 3
    await sale([{ name: 'Iron Sword', qty: 1, price: 50 }]); // 50 over 1
    expect((await itemRow()).avgValue).toBe(80 / 4);
  });

  it('falls back to whichever side has data', async () => {
    await sale([{ name: 'Iron Sword', qty: 2, price: 40 }]);
    const i = await itemRow();
    expect(i.avgValue).toBe(40);
    expect(i.avgValue).toBe(i.avgSold);
  });

  it('is null for an indexed item with no trade at all', async () => {
    const items = (await marketAnalysis(env, R)).items;
    expect(items).toEqual([]);  // an item is only listed once it has moved
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
