/**
 * Order-number uniqueness + void isolation.
 *
 * The order number used to be a 1-second timestamp, so two sales rung up in the
 * same second at the same shop collided — and voiding one then voided BOTH rows
 * while only restocking/refunding the first. The offline queue makes this very
 * reachable, since it replays queued sales back-to-back.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema } from '../src/db.js';

vi.mock('../src/cert.js', () => ({ checkCertification: async () => ({ status: 'VALID' }) }));
vi.mock('../src/audit.js', () => ({ logAudit: async () => {} }));
vi.mock('../src/item-index.js', () => ({
  listItemIndex: async () => ([{ name: 'Iron Sword', baseValue: 30 }]),
  matchMasterItem: (name, master) => master.find((m) => m.name.toLowerCase() === String(name || '').trim().toLowerCase()) || null,
}));

import { checkout, voidSale } from '../src/sales.js';
import { cofferBalance } from '../src/coffers.js';

let env;
const caller = { character: 'Tester', email: 't@example.com' };

beforeAll(async () => { env = { DB: makeD1() }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of ['inventory', 'sales', 'coffer_entries']) await env.DB.prepare('DELETE FROM ' + t).run();
  await env.DB.prepare("INSERT INTO inventory (business, item, price, stock, low_stock) VALUES ('Alpha','Iron Sword',30,10,0)").run();
});

const line = (qty) => ({ cart: [{ item: 'Iron Sword', qty, price: 10 }], hold: 'Whiterun' });

describe('order numbers', () => {
  it('are unique for back-to-back sales in the same second', async () => {
    const a = await checkout(env, 'Alpha', caller, line(1));
    const b = await checkout(env, 'Alpha', caller, line(1));
    expect(a.orderNo).not.toBe(b.orderNo);
  });

  it('voids exactly one sale, restocking and refunding only that one', async () => {
    const a = await checkout(env, 'Alpha', caller, line(1)); // 10gp, stock 10 -> 9
    const b = await checkout(env, 'Alpha', caller, line(1)); // 10gp, stock 9 -> 8
    expect(await cofferBalance(env, 'Alpha')).toBe(20);

    await voidSale(env, 'Alpha', a.orderNo);

    // Only sale A is voided; B still stands.
    const rows = (await env.DB.prepare('SELECT order_no, status FROM sales WHERE business = ?').bind('Alpha').all()).results;
    const voided = rows.filter((r) => String(r.status).toUpperCase() === 'VOIDED');
    expect(voided).toHaveLength(1);
    expect(voided[0].order_no).toBe(a.orderNo);

    // One unit back in stock, one sale's worth reversed from the coffers.
    const stock = (await env.DB.prepare("SELECT stock FROM inventory WHERE business='Alpha' AND item='Iron Sword'").first()).stock;
    expect(stock).toBe(9);
    expect(await cofferBalance(env, 'Alpha')).toBe(10);
    expect(b.orderNo).toBeTruthy();
  });
});
