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

async function seed(business, item, price, stock, ingredient) {
  await env.DB.prepare('INSERT INTO inventory (business, item, price, stock, low_stock, ingredient) VALUES (?, ?, ?, ?, 0, ?)')
    .bind(business, item, price, stock, ingredient ? 1 : 0).run();
}
async function stockOf(b, i) {
  const r = await env.DB.prepare('SELECT stock FROM inventory WHERE business = ? AND item = ?').bind(b, i).first();
  return r ? r.stock : null;
}

beforeAll(async () => { env = { DB: makeD1() }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of ['inventory', 'sales', 'coffer_entries', 'companies',
    'court_settings', 'court_status', 'court_price', 'court_dues']) {
    await env.DB.prepare('DELETE FROM ' + t).run();
  }
});

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
/**
 * Fractional prices are ACCEPTED; the money that changes hands is whole coins,
 * rounded down. The rounding happens once, on the total — rounding every line
 * would compound the loss across a big cart.
 */
describe('whole coins, rounded down', () => {
  it('accepts a fractional price and settles the total down', async () => {
    await seed('Alpha', 'Iron Sword', 30, 10);
    const res = await checkout(env, 'Alpha', caller,
      { cart: [{ item: 'Iron Sword', qty: 1, price: 22.5 }], hold: 'Whiterun' }, 'default');
    expect(res.total).toBe(22);
    expect(await cofferBalance(env, 'Alpha', 'default')).toBe(22);
  });

  it('rounds once at the total, not per line', async () => {
    // Three lines at 10.5 are 31.5 together. Rounding each line down would take
    // 30 — a whole coin lost to the arithmetic rather than to the rounding.
    await seed('Alpha', 'Iron Sword', 30, 10);
    const res = await checkout(env, 'Alpha', caller,
      { cart: [{ item: 'Iron Sword', qty: 3, price: 10.5 }], hold: 'Whiterun' }, 'default');
    expect(res.total).toBe(31);
  });

  it('rounds a percentage discount down too', async () => {
    // 15% off 25 is 21.25.
    await seed('Alpha', 'Iron Sword', 30, 10);
    const res = await checkout(env, 'Alpha', caller,
      { cart: [{ item: 'Iron Sword', qty: 1, price: 25 }], hold: 'Whiterun', discountPercent: 15 }, 'default');
    expect(res.total).toBe(21);
  });

  it('never rounds up, however close', async () => {
    await seed('Alpha', 'Iron Sword', 30, 10);
    const res = await checkout(env, 'Alpha', caller,
      { cart: [{ item: 'Iron Sword', qty: 1, price: 24.999 }], hold: 'Whiterun' }, 'default');
    expect(res.total).toBe(24);
  });

  it('a sale worth less than a coin takes nothing', async () => {
    await seed('Alpha', 'Iron Sword', 30, 10);
    const res = await checkout(env, 'Alpha', caller,
      { cart: [{ item: 'Iron Sword', qty: 1, price: 0.5 }], hold: 'Whiterun' }, 'default');
    expect(res.total).toBe(0);
    expect(await stockOf('Alpha', 'Iron Sword')).toBe(9); // the goods still moved
  });

  it('voiding gives back exactly what was taken', async () => {
    await seed('Alpha', 'Iron Sword', 30, 10);
    const res = await checkout(env, 'Alpha', caller,
      { cart: [{ item: 'Iron Sword', qty: 3, price: 10.5 }], hold: 'Whiterun' }, 'default');
    expect(await cofferBalance(env, 'Alpha', 'default')).toBe(31);
    await voidSale(env, 'Alpha', res.orderNo, 'default');
    // Not 31.5 back against 31 taken — a void must not mint half a coin.
    expect(await cofferBalance(env, 'Alpha', 'default')).toBe(0);
  });
});

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

/**
 * The register hides ingredients, but hiding is not enforcing: a stale page or
 * a replayed offline sale would otherwise sell the shop's crafting materials.
 */
describe('ingredients cannot be sold', () => {
  it('refuses a line for stock the shop holds as an ingredient', async () => {
    await seed('Alpha', 'Iron Sword', 30, 10, true);
    await expect(checkout(env, 'Alpha', caller,
      { cart: [{ item: 'Iron Sword', qty: 1, price: 30 }], hold: 'Whiterun' }, 'default'))
      .rejects.toThrow(/marked as an ingredient/i);
    expect(await stockOf('Alpha', 'Iron Sword')).toBe(10);
  });

  it('refuses the whole order, not just that line', async () => {
    await seed('Alpha', 'Iron Sword', 30, 10, true);
    await seed('Alpha', 'Health Potion', 5, 10);
    await expect(checkout(env, 'Alpha', caller, {
      cart: [{ item: 'Health Potion', qty: 2, price: 5 }, { item: 'Iron Sword', qty: 1, price: 30 }],
      hold: 'Whiterun',
    }, 'default')).rejects.toThrow(/ingredient/i);
    expect(await stockOf('Alpha', 'Health Potion')).toBe(10);
  });

  it('still sells an item another shop keeps as an ingredient', async () => {
    await seed('Alpha', 'Iron Sword', 30, 10);
    await seed('Rival', 'Iron Sword', 30, 10, true);
    const res = await checkout(env, 'Alpha', caller,
      { cart: [{ item: 'Iron Sword', qty: 1, price: 30 }], hold: 'Whiterun' }, 'default');
    expect(res.total).toBe(30);
  });

  it('still sells an indexed item the shop does not stock at all', async () => {
    // Nothing in this shop's inventory says otherwise, so it is sellable.
    const res = await checkout(env, 'Alpha', caller,
      { cart: [{ item: 'Health Potion', qty: 1, price: 5 }], hold: 'Whiterun' }, 'default');
    expect(res.total).toBe(5);
    expect(res.offInventory).toEqual(['Health Potion']);
  });
});

/**
 * A Court's rules reach the register: a barred shop cannot sell, a capped item
 * cannot be sold outside its bounds, and a levy accrues as a debt.
 *
 * courtRules returns null when no company in the region holds the Court flag,
 * so every test above runs with no Court and pays nothing for the feature.
 */
describe('a Court\'s rules at the register', () => {
  const HOLD = 'Whiterun';
  async function seatCourt(taxPercent) {
    await env.DB.prepare(
      `INSERT INTO companies (id, realm_id, business, hold, court, priority, perpetual, status)
       VALUES ('co-court', 'default', 'Whiterun Court', ?, 1, 0, 1, 'VALID')`).bind(HOLD).run();
    if (taxPercent != null) {
      await env.DB.prepare('INSERT INTO court_settings (realm_id, hold, tax_percent, notice) VALUES (?, ?, ?, \'\')')
        .bind('default', HOLD, taxPercent).run();
    }
  }

  it('bars a sanctioned shop from selling', async () => {
    await seatCourt(null);
    await seed('Alpha', 'Iron Sword', 30, 10);
    await env.DB.prepare(
      "INSERT INTO court_status (realm_id, hold, business, standing, note, updated) VALUES ('default', ?, 'Alpha', 'banned', '', '')")
      .bind(HOLD).run();
    await expect(checkout(env, 'Alpha', caller,
      { cart: [{ item: 'Iron Sword', qty: 1, price: 30 }], hold: HOLD }, 'default'))
      .rejects.toThrow(/barred this shop/i);
    expect(await stockOf('Alpha', 'Iron Sword')).toBe(10);
  });

  it('lets a restricted shop keep trading — it is a warning, not a stop', async () => {
    await seatCourt(null);
    await seed('Alpha', 'Iron Sword', 30, 10);
    await env.DB.prepare(
      "INSERT INTO court_status (realm_id, hold, business, standing, note, updated) VALUES ('default', ?, 'Alpha', 'restricted', '', '')")
      .bind(HOLD).run();
    const res = await checkout(env, 'Alpha', caller,
      { cart: [{ item: 'Iron Sword', qty: 1, price: 30 }], hold: HOLD }, 'default');
    expect(res.total).toBe(30);
  });

  it('refuses a line above the Court\'s ceiling, naming the bound', async () => {
    await seatCourt(null);
    await seed('Alpha', 'Iron Sword', 30, 10);
    await env.DB.prepare(
      "INSERT INTO court_price (realm_id, hold, item, min_price, max_price, updated) VALUES ('default', ?, 'Iron Sword', NULL, 40, '')")
      .bind(HOLD).run();
    await expect(checkout(env, 'Alpha', caller,
      { cart: [{ item: 'Iron Sword', qty: 1, price: 55 }], hold: HOLD }, 'default'))
      .rejects.toThrow(/caps Iron Sword at 40/i);
    expect(await stockOf('Alpha', 'Iron Sword')).toBe(10);
  });

  it('refuses a line below the floor', async () => {
    await seatCourt(null);
    await seed('Alpha', 'Iron Sword', 30, 10);
    await env.DB.prepare(
      "INSERT INTO court_price (realm_id, hold, item, min_price, max_price, updated) VALUES ('default', ?, 'Iron Sword', 20, NULL, '')")
      .bind(HOLD).run();
    await expect(checkout(env, 'Alpha', caller,
      { cart: [{ item: 'Iron Sword', qty: 1, price: 5 }], hold: HOLD }, 'default'))
      .rejects.toThrow(/floor of 20/i);
  });

  it('accrues the levy as a debt and takes no money', async () => {
    await seatCourt(10);
    await seed('Alpha', 'Iron Sword', 30, 10);
    const res = await checkout(env, 'Alpha', caller,
      { cart: [{ item: 'Iron Sword', qty: 2, price: 25 }], hold: HOLD }, 'default');
    expect(res.total).toBe(50);
    expect(res.levy).toBe(5);
    // The shop keeps its takings; the Court is owed, not paid.
    expect(await cofferBalance(env, 'Alpha', 'default')).toBe(50);
    expect(await cofferBalance(env, 'Whiterun Court', 'default')).toBe(0);
  });

  it('charges no levy on an employee purchase — it took no money', async () => {
    await seatCourt(10);
    await seed('Alpha', 'Iron Sword', 30, 10);
    const res = await checkout(env, 'Alpha', caller,
      { cart: [{ item: 'Iron Sword', qty: 2, price: 25 }], hold: HOLD, staffPurchase: true }, 'default');
    expect(res.levy).toBe(0);
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM court_dues').first();
    expect(rows.n).toBe(0);
  });

  it('does nothing at all in a region with no Court', async () => {
    await seed('Alpha', 'Iron Sword', 30, 10);
    const res = await checkout(env, 'Alpha', caller,
      { cart: [{ item: 'Iron Sword', qty: 1, price: 999 }], hold: 'The Rift' }, 'default');
    expect(res.levy).toBe(0);
  });
});
