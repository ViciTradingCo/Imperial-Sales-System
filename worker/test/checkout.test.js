/**
 * Checkout integration tests. The Sheets-backed dependencies (certification, the
 * master item index, the audit log) are mocked so we can exercise checkout's D1
 * logic — stock decrement, coffer credit, off-inventory/new-item flags, and
 * idempotency — against the in-memory D1 shim.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema } from '../src/db.js';

vi.mock('../src/cert.js', () => ({ checkCertification: async () => ({ status: 'VALID' }) }));
vi.mock('../src/audit.js', () => ({ logAudit: async () => {} }));
vi.mock('../src/item-index.js', () => ({
  listItemIndex: async () => ([{ name: 'Iron Sword', baseValue: 30 }, { name: 'Health Potion', baseValue: 5 }]),
  matchMasterItem: (name, master) => master.find((m) => m.name.toLowerCase() === String(name || '').trim().toLowerCase()) || null,
}));

import { checkout, listSales, voidSale, employeePerformance } from '../src/sales.js';
import { cofferBalance } from '../src/coffers.js';

let env;
const caller = { character: 'Tester', email: 't@example.com' };

async function seed(business, item, price, stock) {
  await env.DB.prepare('INSERT INTO inventory (business, item, price, stock, low_stock) VALUES (?, ?, ?, ?, 0)')
    .bind(business, item, price, stock).run();
}
async function stockOf(b, i) {
  const r = await env.DB.prepare('SELECT stock FROM inventory WHERE business = ? AND item = ?').bind(b, i).first();
  return r ? r.stock : null;
}

beforeAll(async () => { env = { DB: makeD1() }; await ensureSchema(env); });
beforeEach(async () => { for (const t of ['inventory', 'sales', 'coffer_entries']) await env.DB.prepare('DELETE FROM ' + t).run(); });

describe('checkout', () => {
  it('decrements stock, records the sale, and credits coffers', async () => {
    await seed('Alpha', 'Iron Sword', 30, 10);
    const res = await checkout(env, 'Alpha', caller, { cart: [{ item: 'Iron Sword', qty: 2, price: 25 }], hold: 'Whiterun' }, 'default');
    expect(res.total).toBe(50);
    expect(await stockOf('Alpha', 'Iron Sword')).toBe(8);
    expect(await cofferBalance(env, 'Alpha', 'default')).toBe(50);
  });

  it('sells an off-inventory item without touching stock, and flags it', async () => {
    await seed('Alpha', 'Iron Sword', 30, 10);
    const res = await checkout(env, 'Alpha', caller, { cart: [{ item: 'Health Potion', qty: 3, price: 5 }], hold: 'Whiterun' }, 'default');
    expect(res.offInventory).toContain('Health Potion');
    expect(res.total).toBe(15);
    expect(await stockOf('Alpha', 'Iron Sword')).toBe(10); // untouched
  });

  it('flags a non-master item as new', async () => {
    await seed('Alpha', 'Iron Sword', 30, 10);
    const res = await checkout(env, 'Alpha', caller, { cart: [{ item: 'Mystery Trinket', qty: 1, price: 99 }], hold: 'Whiterun' }, 'default');
    expect(res.newItems).toContain('Mystery Trinket');
  });

  it('is idempotent on a repeated key', async () => {
    await seed('Alpha', 'Iron Sword', 30, 10);
    const a = await checkout(env, 'Alpha', caller, { cart: [{ item: 'Iron Sword', qty: 1, price: 30 }], hold: 'Whiterun', idempotencyKey: 'x1' }, 'default');
    const b = await checkout(env, 'Alpha', caller, { cart: [{ item: 'Iron Sword', qty: 1, price: 30 }], hold: 'Whiterun', idempotencyKey: 'x1' }, 'default');
    expect(b.duplicate).toBe(true);
    expect(b.orderNo).toBe(a.orderNo);
    expect(await stockOf('Alpha', 'Iron Sword')).toBe(9); // decremented once, not twice
  });

  it('blocks a sale that exceeds stock', async () => {
    await seed('Alpha', 'Iron Sword', 30, 2);
    await expect(checkout(env, 'Alpha', caller, { cart: [{ item: 'Iron Sword', qty: 5, price: 30 }], hold: 'Whiterun' }, 'default'))
      .rejects.toThrow(/not enough stock/i);
  });
});

/**
 * An employee purchase: stock leaves, nothing is charged. It has to be a real
 * record (the goods are gone) that is nonetheless invisible to every figure —
 * a free item counted at 0 would drag an item's average price down and make the
 * shop look like it was giving stock away.
 */
describe('employee purchases', () => {
  it('takes the stock but no money, and credits no coffer', async () => {
    await seed('Alpha', 'Iron Sword', 30, 10);
    const res = await checkout(env, 'Alpha', caller,
      { cart: [{ item: 'Iron Sword', qty: 3, price: 30 }], hold: 'Whiterun', staffPurchase: true }, 'default');
    expect(res.total).toBe(0);
    expect(res.staffPurchase).toBe(true);
    expect(await stockOf('Alpha', 'Iron Sword')).toBe(7);
    expect(await cofferBalance(env, 'Alpha', 'default')).toBe(0);
    // No zero-value coffer entry either — that would be noise in the ledger.
    const entries = await env.DB.prepare('SELECT COUNT(*) AS n FROM coffer_entries').first();
    expect(entries.n).toBe(0);
  });

  it('keeps the line prices, so the record says what the goods were worth', async () => {
    await seed('Alpha', 'Iron Sword', 30, 10);
    await checkout(env, 'Alpha', caller,
      { cart: [{ item: 'Iron Sword', qty: 2, price: 30 }], hold: 'Whiterun', staffPurchase: true }, 'default');
    const [sale] = await listSales(env, 'Alpha', '', 'default');
    expect(sale.staffPurchase).toBe(true);
    expect(sale.total).toBe(0);
    expect(sale.lines).toEqual([{ name: 'Iron Sword', qty: 2, price: 30 }]);
  });

  it('ignores a discount rather than recording one that did no work', async () => {
    await seed('Alpha', 'Iron Sword', 30, 10);
    await checkout(env, 'Alpha', caller, {
      cart: [{ item: 'Iron Sword', qty: 1, price: 30 }], hold: 'Whiterun',
      staffPurchase: true, discountName: 'Staff', discountPercent: 50,
    }, 'default');
    const [sale] = await listSales(env, 'Alpha', '', 'default');
    expect(sale.total).toBe(0);
    expect(sale.discount).toBe('');
  });

  it('does not count toward the employee who rang it up', async () => {
    await seed('Alpha', 'Iron Sword', 30, 10);
    await checkout(env, 'Alpha', caller,
      { cart: [{ item: 'Iron Sword', qty: 1, price: 30 }], hold: 'Whiterun' }, 'default');
    await checkout(env, 'Alpha', caller,
      { cart: [{ item: 'Iron Sword', qty: 5, price: 30 }], hold: 'Whiterun', staffPurchase: true }, 'default');
    const [perf] = await employeePerformance(env, 'Alpha', 'default');
    expect(perf.orders).toBe(1);
    expect(perf.revenue).toBe(30);
  });

  it('voids back to stock without a phantom coffer reversal', async () => {
    await seed('Alpha', 'Iron Sword', 30, 10);
    const res = await checkout(env, 'Alpha', caller,
      { cart: [{ item: 'Iron Sword', qty: 4, price: 30 }], hold: 'Whiterun', staffPurchase: true }, 'default');
    await voidSale(env, 'Alpha', res.orderNo, 'default');
    expect(await stockOf('Alpha', 'Iron Sword')).toBe(10);
    const entries = await env.DB.prepare('SELECT COUNT(*) AS n FROM coffer_entries').first();
    expect(entries.n).toBe(0);
  });

  it('is off by default — an ordinary sale still charges', async () => {
    await seed('Alpha', 'Iron Sword', 30, 10);
    const res = await checkout(env, 'Alpha', caller,
      { cart: [{ item: 'Iron Sword', qty: 2, price: 25 }], hold: 'Whiterun' }, 'default');
    expect(res.total).toBe(50);
    expect(res.staffPurchase).toBe(false);
    expect(await cofferBalance(env, 'Alpha', 'default')).toBe(50);
  });
});
