/**
 * A SHOP'S OWN PERFORMANCE.
 *
 * The report an owner reads, and the one place in the app where several
 * different questions are answered off one set of rows. What has to hold:
 *   • the two clocks stay apart — all-time headline figures, a 30-day window
 *     for anything that is only meaningful against one;
 *   • money in and out comes from the COFFER, so the page cannot disagree with
 *     the shop's own ledger;
 *   • a special counts as the UNITS it moved and never as a per-item price,
 *     which is the rule the whole bundle design rests on;
 *   • nothing counts a voided sale or an employee purchase as trade.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { businessReport } from '../src/shop-report.js';
import { importItemIndex } from '../src/item-index.js';
import { saveBundle } from '../src/bundles.js';
import { checkout, voidSale } from '../src/sales.js';

let env;
const R = DEFAULT_REALM_ID;
const SHOP = 'The Tavern';
const caller = { uid: 'u-1', character: 'Tess', email: 't@x.com' };
const ring = (cart, opts) => checkout(env, SHOP, caller, { cart, hold: 'Whiterun', ...opts }, R);
const report = () => businessReport(env, SHOP, R);

/** A sale written straight in, so its timestamp can be anywhere in the past. */
async function saleOn(daysAgo, { total, lines, customer, qty }) {
  const ts = new Date(Date.now() - daysAgo * 86400000).toISOString();
  await env.DB.prepare(
    `INSERT INTO sales (realm_id, business, ts, order_no, customer, hold, items, qty_total, total, employee, status, staff_purchase)
     VALUES (?, ?, ?, ?, ?, 'Whiterun', ?, ?, ?, 'Tess', '', 0)`)
    .bind(R, SHOP, ts, 'ORD-' + daysAgo + '-' + Math.random().toString(36).slice(2, 6),
      customer || '', JSON.stringify(lines), qty, total).run();
}

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run();
  await env.DB.prepare("INSERT INTO companies (id, business, perpetual, status, realm_id) VALUES ('c1', ?, 1, 'VALID', ?)")
    .bind(SHOP, R).run();
  await importItemIndex(env, [{ name: 'Ale', baseValue: 4 }, { name: 'Stew', baseValue: 9 }, { name: 'Iron Sword', baseValue: 25 }], R);
  for (const [item, price, stock, tags] of [
    ['Ale', 5, 100, 'drink'], ['Stew', 10, 100, 'food'], ['Iron Sword', 30, 6, 'weapon'],
  ]) {
    await env.DB.prepare(
      'INSERT INTO inventory (realm_id, business, item, price, stock, low_stock, tags) VALUES (?, ?, ?, ?, ?, 0, ?)')
      .bind(R, SHOP, item, price, stock, tags).run();
  }
});

describe('the headline figures', () => {
  it('averages an order out of what it already counted', async () => {
    await ring([{ item: 'Ale', qty: 2, price: 5 }]);          // 10
    await ring([{ item: 'Stew', qty: 3, price: 10 }]);         // 30
    const r = await report();
    expect(r.overview).toMatchObject({ revenue: 40, orders: 2, itemsSold: 5 });
    expect(r.overview.avgOrder).toBe(20);
    expect(r.overview.itemsPerOrder).toBe(2.5);
  });

  it('counts customers by name, and which of them came back', async () => {
    await saleOn(1, { total: 10, qty: 1, customer: 'Lydia', lines: [{ name: 'Ale', qty: 2, price: 5 }] });
    await saleOn(2, { total: 10, qty: 1, customer: 'lydia', lines: [{ name: 'Ale', qty: 2, price: 5 }] });
    await saleOn(3, { total: 10, qty: 1, customer: 'Uthgerd', lines: [{ name: 'Ale', qty: 2, price: 5 }] });
    await saleOn(4, { total: 10, qty: 1, customer: '', lines: [{ name: 'Ale', qty: 2, price: 5 }] });
    const { overview } = await report();
    expect(overview.customers).toBe(2); // an unnamed customer is not a person you know
    expect(overview.repeat).toBe(1);
  });

  it('says what discounts gave away, from the lines against the total', async () => {
    await ring([{ item: 'Stew', qty: 4, price: 10 }], { discountName: 'Feast day', discountPercent: 25 });
    const { overview } = await report();
    expect(overview.discountGiven).toBe(10); // 40 of lines, 30 taken
  });

  it('reads an upcharge as the negative of one, not as a second figure', async () => {
    await ring([{ item: 'Stew', qty: 1, price: 10 }], { discountName: 'Rush', discountPercent: -50 });
    const { overview } = await report();
    expect(overview.discountGiven).toBe(-5);
  });

  it('counts voids and employee purchases WITHOUT counting them as trade', async () => {
    const sale = await ring([{ item: 'Ale', qty: 2, price: 5 }]);
    await voidSale(env, SHOP, sale.orderNo, R);
    await ring([{ item: 'Ale', qty: 1, price: 5 }], { staffPurchase: true });
    await ring([{ item: 'Stew', qty: 1, price: 10 }]);

    const { overview } = await report();
    expect(overview.revenue).toBe(10);   // only the one real sale
    expect(overview.orders).toBe(1);
    expect(overview.voided).toBe(1);
    expect(overview.staffOrders).toBe(1);
    expect(overview.staffUnits).toBe(1);
  });
});

describe('the last 30 days', () => {
  it('separates this window from the one before it', async () => {
    await saleOn(3, { total: 100, qty: 1, lines: [{ name: 'Ale', qty: 1, price: 100 }] });
    await saleOn(40, { total: 60, qty: 1, lines: [{ name: 'Ale', qty: 1, price: 60 }] });
    await saleOn(200, { total: 999, qty: 1, lines: [{ name: 'Ale', qty: 1, price: 999 }] });

    const { overview, period } = await report();
    expect(overview.revenue).toBe(1159); // all time
    expect(period.revenue).toBe(100);    // this window
    expect(period.prevRevenue).toBe(60); // the 30 days before it, and nothing older
  });

  it('counts the days it actually traded, not the days that passed', async () => {
    await saleOn(1, { total: 10, qty: 1, lines: [{ name: 'Ale', qty: 2, price: 5 }] });
    await saleOn(1, { total: 10, qty: 1, lines: [{ name: 'Ale', qty: 2, price: 5 }] });
    await saleOn(5, { total: 10, qty: 1, lines: [{ name: 'Ale', qty: 2, price: 5 }] });
    expect((await report()).period.activeDays).toBe(2);
  });

  /**
   * The day's NUMBER, never its name: what Saturday is called depends on who is
   * reading, and this end of the app has no idea. The browser names it.
   */
  it('gives the best weekday as a number, and nothing when nothing sold', async () => {
    const { period } = await report();
    expect(period.busiestDay).toBe(null); // an absent day is not Sunday
    await saleOn(2, { total: 80, qty: 1, lines: [{ name: 'Ale', qty: 1, price: 80 }] });
    const after = await report();
    expect(after.period.busiestDay).toBe(new Date(Date.now() - 2 * 86400000).getDay());
    expect(after.period.busiestRevenue).toBe(80);
  });

  /** The coffer is the ledger; this page must not invent a second version of it. */
  it('takes money in and out from the COFFER, wages and all', async () => {
    await ring([{ item: 'Stew', qty: 5, price: 10 }]); // +50 credited by checkout
    const ts = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO coffer_entries (realm_id, business, ts, kind, amount, note) VALUES (?, ?, ?, 'wages', ?, 'Paid Tess')`)
      .bind(R, SHOP, ts, -20).run();

    const { period } = await report();
    expect(period.moneyIn).toBe(50);
    expect(period.moneyOut).toBe(20); // reported as what it cost, not as −20
    expect(period.kept).toBe(30);
  });
});

describe('the shelf', () => {
  it('values what is held at the shop’s own prices, sellable stock only', async () => {
    await env.DB.prepare(
      'INSERT INTO inventory (realm_id, business, item, price, stock, low_stock, ingredient) VALUES (?, ?, ?, ?, ?, 0, 1)')
      .bind(R, SHOP, 'Salt Pile', 1, 40).run();
    const { stock } = await report();
    // 100 ale at 5, 100 stew at 10, 6 swords at 30 — the salt is an ingredient.
    expect(stock.value).toBe(1680);
    expect(stock.units).toBe(206);
    expect(stock.listings).toBe(3);
    expect(stock.ingredients).toBe(1);
  });

  it('lists what is NOT moving, worth most first', async () => {
    await saleOn(2, { total: 10, qty: 2, lines: [{ name: 'Ale', qty: 2, price: 5 }] });
    const { slow } = await report();
    const names = slow.map((s) => s.item);
    expect(names).not.toContain('Ale');      // sold two days ago
    expect(names).toContain('Iron Sword');   // never sold
    expect(slow[0].item).toBe('Stew');       // 100 × 10 is more tied up than 6 × 30
    expect(slow[0]).toMatchObject({ stock: 100, value: 1000, lastSold: '' });
  });

  it('stops calling something slow once it sells', async () => {
    await saleOn(70, { total: 30, qty: 1, lines: [{ name: 'Iron Sword', qty: 1, price: 30 }] });
    expect((await report()).slow.map((s) => s.item)).toContain('Iron Sword');
    await saleOn(2, { total: 30, qty: 1, lines: [{ name: 'Iron Sword', qty: 1, price: 30 }] });
    expect((await report()).slow.map((s) => s.item)).not.toContain('Iron Sword');
  });
});

describe('what sells, by kind', () => {
  it('counts the units of each kind the shop has tagged', async () => {
    await ring([{ item: 'Ale', qty: 3, price: 5 }, { item: 'Stew', qty: 1, price: 10 }]);
    const { kinds } = await report();
    expect(kinds).toEqual([{ tag: 'drink', qty: 3 }, { tag: 'food', qty: 1 }]);
  });

  /**
   * A special is one line at one price. Its UNITS are real and are counted; its
   * money has no per-item split and none is invented here.
   */
  it('counts what a special MOVED, through its parts', async () => {
    await saveBundle(env, SHOP, { name: 'Feast', price: 40, parts: [{ item: 'Ale', qty: 2 }, { item: 'Stew', qty: 2 }] }, R);
    await ring([{ bundle: 'Feast', qty: 2 }]);
    const r = await report();
    expect(r.kinds).toEqual([{ tag: 'drink', qty: 4 }, { tag: 'food', qty: 4 }]);
    expect(r.period.itemsSold).toBe(8);
    expect(r.period.revenue).toBe(80);
  });

  it('says nothing at all when a shop has tagged nothing', async () => {
    await env.DB.prepare("UPDATE inventory SET tags = '' WHERE realm_id = ? AND business = ?").bind(R, SHOP).run();
    await ring([{ item: 'Ale', qty: 1, price: 5 }]);
    expect((await report()).kinds).toEqual([]);
  });
});
