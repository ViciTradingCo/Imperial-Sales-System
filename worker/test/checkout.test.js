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

import { checkout } from '../src/sales.js';
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
    const res = await checkout(env, 'Alpha', caller, { cart: [{ item: 'Iron Sword', qty: 2, price: 25 }], hold: 'Whiterun' });
    expect(res.total).toBe(50);
    expect(await stockOf('Alpha', 'Iron Sword')).toBe(8);
    expect(await cofferBalance(env, 'Alpha')).toBe(50);
  });

  it('sells an off-inventory item without touching stock, and flags it', async () => {
    await seed('Alpha', 'Iron Sword', 30, 10);
    const res = await checkout(env, 'Alpha', caller, { cart: [{ item: 'Health Potion', qty: 3, price: 5 }], hold: 'Whiterun' });
    expect(res.offInventory).toContain('Health Potion');
    expect(res.total).toBe(15);
    expect(await stockOf('Alpha', 'Iron Sword')).toBe(10); // untouched
  });

  it('flags a non-master item as new', async () => {
    await seed('Alpha', 'Iron Sword', 30, 10);
    const res = await checkout(env, 'Alpha', caller, { cart: [{ item: 'Mystery Trinket', qty: 1, price: 99 }], hold: 'Whiterun' });
    expect(res.newItems).toContain('Mystery Trinket');
  });

  it('is idempotent on a repeated key', async () => {
    await seed('Alpha', 'Iron Sword', 30, 10);
    const a = await checkout(env, 'Alpha', caller, { cart: [{ item: 'Iron Sword', qty: 1, price: 30 }], hold: 'Whiterun', idempotencyKey: 'x1' });
    const b = await checkout(env, 'Alpha', caller, { cart: [{ item: 'Iron Sword', qty: 1, price: 30 }], hold: 'Whiterun', idempotencyKey: 'x1' });
    expect(b.duplicate).toBe(true);
    expect(b.orderNo).toBe(a.orderNo);
    expect(await stockOf('Alpha', 'Iron Sword')).toBe(9); // decremented once, not twice
  });

  it('blocks a sale that exceeds stock', async () => {
    await seed('Alpha', 'Iron Sword', 30, 2);
    await expect(checkout(env, 'Alpha', caller, { cart: [{ item: 'Iron Sword', qty: 5, price: 30 }], hold: 'Whiterun' }))
      .rejects.toThrow(/not enough stock/i);
  });
});
