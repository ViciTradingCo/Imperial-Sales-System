/**
 * Correcting stock by hand.
 *
 * Every other path moves stock because something happened — a sale, a delivery,
 * a craft. This one exists because the shelf is the real authority, and the
 * thing it must NOT do is look like one of those events: no coffer entry, no
 * purchase, no way to invent an item that the shop does not list.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { setStock, listInventory } from '../src/inventory.js';
import { cofferBalance } from '../src/coffers.js';

let env;
const R = DEFAULT_REALM_ID;
const OTHER = 'rlm-stock-b';
const SHOP = 'Iron Hearth';

const seed = (item, stock, business = SHOP, realm = R) => env.DB.prepare(
  'INSERT INTO inventory (realm_id, business, item, price, stock, low_stock) VALUES (?, ?, ?, 25, ?, 0)')
  .bind(realm, business, item, stock).run();
const stockOf = async (item, business = SHOP, realm = R) => {
  const r = await env.DB.prepare('SELECT stock FROM inventory WHERE realm_id = ? AND business = ? AND item = ?')
    .bind(realm, business, item).first();
  return r ? r.stock : null;
};

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => { for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run(); });

describe('setting stock', () => {
  it('sets the count and reports what it was', async () => {
    await seed('Iron Sword', 10);
    const res = await setStock(env, SHOP, { item: 'Iron Sword', stock: 7 }, R);
    expect(res).toMatchObject({ item: 'Iron Sword', was: 10, now: 7 });
    expect(await stockOf('Iron Sword')).toBe(7);
  });

  it('can count up as well as down', async () => {
    await seed('Iron Sword', 2);
    await setStock(env, SHOP, { item: 'Iron Sword', stock: 40 }, R);
    expect(await stockOf('Iron Sword')).toBe(40);
  });

  it('can zero an item without removing its listing', async () => {
    // An item at zero keeps its price and its history, ready for the next
    // delivery — that is why zeroing and removing are different actions.
    await seed('Iron Sword', 5);
    await setStock(env, SHOP, { item: 'Iron Sword', stock: 0 }, R);
    expect(await stockOf('Iron Sword')).toBe(0);
    expect((await listInventory(env, SHOP, R)).map((i) => i.item)).toContain('Iron Sword');
  });

  it('moves no money — this corrects a count, it does not buy anything', async () => {
    await seed('Iron Sword', 2);
    await setStock(env, SHOP, { item: 'Iron Sword', stock: 200 }, R);
    expect(await cofferBalance(env, SHOP, R)).toBe(0);
    const { results } = await env.DB.prepare('SELECT id FROM coffer_entries').all();
    expect(results).toHaveLength(0);
  });

  it('records no intake either', async () => {
    await seed('Iron Sword', 2);
    await setStock(env, SHOP, { item: 'Iron Sword', stock: 9 }, R);
    const { results } = await env.DB.prepare('SELECT id FROM intake').all();
    expect(results).toHaveLength(0);
  });

  it('matches the item however it is cased, and stores the real name', async () => {
    await seed('Iron Sword', 3);
    const res = await setStock(env, SHOP, { item: 'iron SWORD', stock: 6 }, R);
    expect(res.item).toBe('Iron Sword');
    expect(await stockOf('Iron Sword')).toBe(6);
  });

  it('keeps the note for the audit trail', async () => {
    await seed('Iron Sword', 3);
    const res = await setStock(env, SHOP, { item: 'Iron Sword', stock: 1, note: 'Two broke in transit' }, R);
    expect(res.note).toBe('Two broke in transit');
  });
});

describe('what it refuses', () => {
  it('an item the shop does not list — this is not a way to invent inventory', async () => {
    await expect(setStock(env, SHOP, { item: 'Daedric Greatsword', stock: 5 }, R))
      .rejects.toThrow(/not in your inventory/i);
  });

  it('a negative count', async () => {
    await seed('Iron Sword', 3);
    await expect(setStock(env, SHOP, { item: 'Iron Sword', stock: -1 }, R)).rejects.toThrow(/0 or more/i);
  });

  it('a count that is not a number', async () => {
    await seed('Iron Sword', 3);
    await expect(setStock(env, SHOP, { item: 'Iron Sword', stock: 'lots' }, R)).rejects.toThrow(/whole number/i);
  });

  it('no item at all', async () => {
    await expect(setStock(env, SHOP, { stock: 5 }, R)).rejects.toThrow(/which item/i);
  });

  it('a fractional count — stock is things, and half a sword is not one', async () => {
    await seed('Iron Sword', 3);
    await setStock(env, SHOP, { item: 'Iron Sword', stock: 7.9 }, R);
    expect(await stockOf('Iron Sword')).toBe(7);
  });
});

describe('scope', () => {
  it('cannot reach another shop\'s stock', async () => {
    await seed('Iron Sword', 10, 'Rift Traders');
    await expect(setStock(env, SHOP, { item: 'Iron Sword', stock: 0 }, R))
      .rejects.toThrow(/not in your inventory/i);
    expect(await stockOf('Iron Sword', 'Rift Traders')).toBe(10);
  });

  it('cannot reach the same shop in another realm', async () => {
    await seed('Iron Sword', 10, SHOP, OTHER);
    await expect(setStock(env, SHOP, { item: 'Iron Sword', stock: 0 }, R))
      .rejects.toThrow(/not in your inventory/i);
    expect(await stockOf('Iron Sword', SHOP, OTHER)).toBe(10);
  });
});
