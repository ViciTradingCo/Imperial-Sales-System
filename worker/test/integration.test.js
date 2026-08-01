/**
 * Integration tests for the D1-backed money/stock invariants, using an in-memory
 * SQLite D1 shim. These cover the paths that must never lose or duplicate stock
 * or gold: transfers (send/accept/decline/cancel) and coffer adjustments.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1, } from './d1shim.js';
import { ensureSchema } from '../src/db.js';
import { createTransfer, acceptTransfer, declineTransfer, cancelTransfer, listTransfers } from '../src/transfers.js';
import { adjustCoffer, cofferBalance } from '../src/coffers.js';

let env;

async function seedItem(business, item, price, stock) {
  await env.DB.prepare("INSERT INTO inventory (realm_id, business, item, price, stock, low_stock) VALUES ('default', ?, ?, ?, ?, 0)")
    .bind(business, item, price, stock).run();
}
async function stockOf(business, item) {
  const r = await env.DB.prepare('SELECT stock FROM inventory WHERE business = ? AND item = ?').bind(business, item).first();
  return r ? r.stock : null;
}

beforeAll(async () => {
  env = { DB: makeD1() };
  await ensureSchema(env);
});

beforeEach(async () => {
  for (const t of ['inventory', 'transfers', 'coffer_entries']) {
    await env.DB.prepare('DELETE FROM ' + t).run();
  }
});

describe('transfers conserve stock', () => {
  it('accept moves stock from sender to receiver', async () => {
    await seedItem('Alpha', 'Iron Sword', 30, 10);
    await createTransfer(env, 'Alpha', { toBusiness: 'Beta', item: 'Iron Sword', qty: 3 }, 'default');
    expect(await stockOf('Alpha', 'Iron Sword')).toBe(7); // debited on send

    const { incoming } = await listTransfers(env, 'Beta', 'default');
    expect(incoming).toHaveLength(1);
    await acceptTransfer(env, 'Beta', incoming[0].id, 'default');

    expect(await stockOf('Alpha', 'Iron Sword')).toBe(7);
    expect(await stockOf('Beta', 'Iron Sword')).toBe(3); // total 7 + 3 == 10 conserved
  });

  it('decline returns the goods to the sender', async () => {
    await seedItem('Alpha', 'Iron Sword', 30, 10);
    await createTransfer(env, 'Alpha', { toBusiness: 'Beta', item: 'Iron Sword', qty: 4 }, 'default');
    expect(await stockOf('Alpha', 'Iron Sword')).toBe(6);
    const { incoming } = await listTransfers(env, 'Beta', 'default');
    await declineTransfer(env, 'Beta', incoming[0].id, 'default');
    expect(await stockOf('Alpha', 'Iron Sword')).toBe(10); // fully restored
    expect(await stockOf('Beta', 'Iron Sword')).toBeNull();
  });

  it('cancel by the sender returns the goods', async () => {
    await seedItem('Alpha', 'Iron Sword', 30, 10);
    await createTransfer(env, 'Alpha', { toBusiness: 'Beta', item: 'Iron Sword', qty: 5 }, 'default');
    const { outgoing } = await listTransfers(env, 'Alpha', 'default');
    await cancelTransfer(env, 'Alpha', outgoing[0].id, 'default');
    expect(await stockOf('Alpha', 'Iron Sword')).toBe(10);
  });

  it('rejects a transfer bigger than stock', async () => {
    await seedItem('Alpha', 'Iron Sword', 30, 2);
    await expect(createTransfer(env, 'Alpha', { toBusiness: 'Beta', item: 'Iron Sword', qty: 5 }, 'default'))
      .rejects.toThrow(/not enough stock/i);
    expect(await stockOf('Alpha', 'Iron Sword')).toBe(2); // unchanged
  });

  it('is idempotent on a repeated send key', async () => {
    await seedItem('Alpha', 'Iron Sword', 30, 10);
    await createTransfer(env, 'Alpha', { toBusiness: 'Beta', item: 'Iron Sword', qty: 3, idempotencyKey: 'k1' }, 'default');
    await createTransfer(env, 'Alpha', { toBusiness: 'Beta', item: 'Iron Sword', qty: 3, idempotencyKey: 'k1' }, 'default');
    expect(await stockOf('Alpha', 'Iron Sword')).toBe(7); // debited once, not twice
  });
});

describe('coffers track balance', () => {
  it('deposits and withdrawals sum to the balance', async () => {
    await adjustCoffer(env, 'Alpha', { amount: 100, note: 'seed' }, 'default');
    await adjustCoffer(env, 'Alpha', { amount: -30, note: 'buy' }, 'default');
    expect(await cofferBalance(env, 'Alpha', 'default')).toBe(70);
  });

  it('rejects a zero adjustment', async () => {
    await expect(adjustCoffer(env, 'Alpha', { amount: 0 }, 'default')).rejects.toThrow(/non-zero/i);
  });
});
