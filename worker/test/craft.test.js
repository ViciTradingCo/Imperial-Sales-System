/**
 * Crafting: ingredients out of stock, the made item in, atomically.
 *
 * The two things worth guarding: a craft can never take the ingredients without
 * producing the output (or vice versa), and it can never leave a shop with
 * negative stock because the same ingredient was listed twice.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { convertItems, listInventory } from '../src/inventory.js';
import { importItemIndex } from '../src/item-index.js';

let env;
const R = DEFAULT_REALM_ID;
const SHOP = 'Iron Hearth';

const stockOf = async (item, business = SHOP, realm = R) => {
  const r = await env.DB.prepare('SELECT stock FROM inventory WHERE realm_id = ? AND business = ? AND item = ?')
    .bind(realm, business, item).first();
  return r ? r.stock : null;
};
const seed = (item, stock, business = SHOP, realm = R) => env.DB.prepare(
  'INSERT INTO inventory (realm_id, business, item, price, stock, low_stock) VALUES (?, ?, ?, 1, ?, 0)')
  .bind(realm, business, item, stock).run();

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run();
  await env.DB.prepare('DELETE FROM sys_flags').run();
  await importItemIndex(env, [
    { name: 'Leather', baseValue: 2 },
    { name: 'Iron Ingot', baseValue: 5 },
    { name: 'Iron Shield', baseValue: 40 },
  ], R);
});

describe('crafting', () => {
  it('consumes the ingredients and adds what was made', async () => {
    await seed('Leather', 10);
    await seed('Iron Ingot', 10);
    const res = await convertItems(env, SHOP, {
      inputs: [{ item: 'Leather', qty: 2 }, { item: 'Iron Ingot', qty: 3 }],
      output: { item: 'Iron Shield', qty: 1 },
    }, R);
    expect(res.made).toEqual({ item: 'Iron Shield', qty: 1 });
    expect(await stockOf('Leather')).toBe(8);
    expect(await stockOf('Iron Ingot')).toBe(7);
    expect(await stockOf('Iron Shield')).toBe(1);
  });

  it('creates the output row at its base value when the shop has never stocked it', async () => {
    await seed('Leather', 5);
    await convertItems(env, SHOP, {
      inputs: [{ item: 'Leather', qty: 5 }], output: { item: 'Iron Shield', qty: 2 },
    }, R);
    const made = (await listInventory(env, SHOP, R)).find((i) => i.item === 'Iron Shield');
    expect(made).toMatchObject({ stock: 2, price: 40 });
  });

  it('adds to an existing stock rather than replacing it', async () => {
    await seed('Leather', 5);
    await seed('Iron Shield', 3);
    await convertItems(env, SHOP, {
      inputs: [{ item: 'Leather', qty: 1 }], output: { item: 'Iron Shield', qty: 2 },
    }, R);
    expect(await stockOf('Iron Shield')).toBe(5);
  });

  it('folds a repeated ingredient before checking stock', async () => {
    await seed('Leather', 5);
    // Three plus three is six, and the shop has five — checking the rows
    // separately would let this through and leave the stock negative.
    await expect(convertItems(env, SHOP, {
      inputs: [{ item: 'Leather', qty: 3 }, { item: 'Leather', qty: 3 }],
      output: { item: 'Iron Shield', qty: 1 },
    }, R)).rejects.toThrow(/not enough leather/i);
    expect(await stockOf('Leather')).toBe(5);
  });

  it('refuses when an ingredient is short, taking nothing', async () => {
    await seed('Leather', 1);
    await seed('Iron Ingot', 10);
    await expect(convertItems(env, SHOP, {
      inputs: [{ item: 'Iron Ingot', qty: 2 }, { item: 'Leather', qty: 5 }],
      output: { item: 'Iron Shield', qty: 1 },
    }, R)).rejects.toThrow(/not enough leather/i);
    // The Iron Ingot line came first and must not have been applied.
    expect(await stockOf('Iron Ingot')).toBe(10);
    expect(await stockOf('Leather')).toBe(1);
  });

  it('refuses an ingredient the shop does not stock at all', async () => {
    await seed('Leather', 5);
    await expect(convertItems(env, SHOP, {
      inputs: [{ item: 'Iron Ingot', qty: 1 }], output: { item: 'Iron Shield', qty: 1 },
    }, R)).rejects.toThrow(/no iron ingot/i);
  });

  it('refuses an output that is not in the item index', async () => {
    await seed('Leather', 5);
    await expect(convertItems(env, SHOP, {
      inputs: [{ item: 'Leather', qty: 1 }], output: { item: 'Dragonbone Warhammer', qty: 1 },
    }, R)).rejects.toThrow(/not in the item index/i);
  });

  it('refuses to make a thing out of itself', async () => {
    await seed('Iron Shield', 5);
    await expect(convertItems(env, SHOP, {
      inputs: [{ item: 'Iron Shield', qty: 1 }], output: { item: 'Iron Shield', qty: 2 },
    }, R)).rejects.toThrow(/its own ingredient/i);
  });

  it('refuses empty or nonsensical quantities', async () => {
    await seed('Leather', 5);
    const out = { item: 'Iron Shield', qty: 1 };
    await expect(convertItems(env, SHOP, { inputs: [], output: out }, R)).rejects.toThrow(/at least one ingredient/i);
    await expect(convertItems(env, SHOP, { inputs: [{ item: 'Leather', qty: 0 }], output: out }, R))
      .rejects.toThrow(/quantity/i);
    await expect(convertItems(env, SHOP, { inputs: [{ item: 'Leather', qty: 1 }], output: { item: 'Iron Shield', qty: 0 } }, R))
      .rejects.toThrow(/how many/i);
  });

  it('does not craft twice on a retried request', async () => {
    await seed('Leather', 10);
    const args = { inputs: [{ item: 'Leather', qty: 4 }], output: { item: 'Iron Shield', qty: 1 }, idempotencyKey: 'k-1' };
    await convertItems(env, SHOP, args, R);
    const again = await convertItems(env, SHOP, args, R);
    expect(again.duplicate).toBe(true);
    expect(await stockOf('Leather')).toBe(6);
    expect(await stockOf('Iron Shield')).toBe(1);
  });

  it('never reaches another shop, or another realm', async () => {
    await seed('Leather', 5);
    await seed('Leather', 5, 'Rival Traders');
    await seed('Leather', 5, SHOP, 'rlm-other');
    await convertItems(env, SHOP, {
      inputs: [{ item: 'Leather', qty: 5 }], output: { item: 'Iron Shield', qty: 1 },
    }, R);
    expect(await stockOf('Leather')).toBe(0);
    expect(await stockOf('Leather', 'Rival Traders')).toBe(5);
    expect(await stockOf('Leather', SHOP, 'rlm-other')).toBe(5);
  });

  it('writes no money movement — nothing was bought or sold', async () => {
    await seed('Leather', 5);
    await convertItems(env, SHOP, {
      inputs: [{ item: 'Leather', qty: 2 }], output: { item: 'Iron Shield', qty: 1 },
    }, R);
    const coffer = await env.DB.prepare('SELECT COUNT(*) AS n FROM coffer_entries').first();
    const intake = await env.DB.prepare('SELECT COUNT(*) AS n FROM intake').first();
    expect(coffer.n).toBe(0);
    expect(intake.n).toBe(0);
  });
});
