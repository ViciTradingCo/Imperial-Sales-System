/**
 * Intake: the sale price an owner sets, and undoing a mistyped delivery.
 *
 * The listing is a PRICE LIST, not a claim to be holding stock — so nothing
 * here may remove an item just because its count reached zero.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { recordIntake, listIntake, deleteIntake } from '../src/intake.js';
import { listInventory } from '../src/inventory.js';
import { cofferBalance } from '../src/coffers.js';

let env;
const R = DEFAULT_REALM_ID;
const SHOP = 'Iron Hearth';

const itemRow = async (name) => (await listInventory(env, SHOP, R)).find((i) => i.item === name);
const take = (over) => recordIntake(env, SHOP, {
  item: 'Iron Sword', vendor: 'Smith', hold: 'Whiterun', numItems: 10, pricePer: 5, ...over,
}, R);

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => { for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run(); });

describe('the sale price', () => {
  it('is what the register will charge, not what the shop paid', async () => {
    await take({ salePrice: 30 });
    expect(await itemRow('Iron Sword')).toMatchObject({ price: 30, stock: 10 });
  });

  it('falls back to the cost for a first delivery with no price given', async () => {
    await take({});
    expect((await itemRow('Iron Sword')).price).toBe(5);
  });

  it('is left alone when a restock does not mention it', async () => {
    await take({ salePrice: 30 });
    await take({ pricePer: 6 });          // cost changed, price must not
    const row = await itemRow('Iron Sword');
    expect(row.price).toBe(30);
    expect(row.stock).toBe(20);
  });

  it('is updated when a restock does give one', async () => {
    await take({ salePrice: 30 });
    await take({ salePrice: 45 });
    expect((await itemRow('Iron Sword')).price).toBe(45);
  });

  it('accepts zero as a deliberate price, not as "unset"', async () => {
    await take({ salePrice: 0 });
    expect((await itemRow('Iron Sword')).price).toBe(0);
  });

  it('refuses a nonsensical price', async () => {
    await expect(take({ salePrice: -5 })).rejects.toThrow(/sale price/i);
  });
});

describe('deleting an intake entry', () => {
  it('takes the stock back out and refunds the coffer', async () => {
    await take({ salePrice: 30 });                     // 10 in, 50 paid
    expect(await cofferBalance(env, SHOP, R)).toBe(-50);
    const [entry] = await listIntake(env, SHOP, R);
    const res = await deleteIntake(env, SHOP, entry.id, R);
    expect(res.removed).toBe(10);
    expect(res.refunded).toBe(50);
    expect(await cofferBalance(env, SHOP, R)).toBe(0);
    expect(await listIntake(env, SHOP, R)).toEqual([]);
  });

  it('KEEPS the listing and its price when that empties the stock', async () => {
    await take({ salePrice: 30 });
    const [entry] = await listIntake(env, SHOP, R);
    await deleteIntake(env, SHOP, entry.id, R);
    // The price list survives the stock going to zero — that is the point.
    expect(await itemRow('Iron Sword')).toMatchObject({ stock: 0, price: 30 });
  });

  it('floors the stock at zero when some of it already sold on', async () => {
    await take({ salePrice: 30 });
    await env.DB.prepare('UPDATE inventory SET stock = 4 WHERE realm_id = ? AND business = ?')
      .bind(R, SHOP).run();                            // six were sold
    const [entry] = await listIntake(env, SHOP, R);
    const res = await deleteIntake(env, SHOP, entry.id, R);
    expect(res.removed).toBe(4);
    expect(res.shortBy).toBe(6);                       // said, not silently absorbed
    expect((await itemRow('Iron Sword')).stock).toBe(0);
  });

  it('removes only the entry named, leaving the rest of the history', async () => {
    await take({});
    await take({ numItems: 3 });
    const entries = await listIntake(env, SHOP, R);
    await deleteIntake(env, SHOP, entries[0].id, R);
    const left = await listIntake(env, SHOP, R);
    expect(left).toHaveLength(1);
    expect(left[0].numItems).toBe(10);
  });

  it('cannot reach another shop\'s or another realm\'s entry', async () => {
    await take({});
    const [entry] = await listIntake(env, SHOP, R);
    await expect(deleteIntake(env, 'Rival Traders', entry.id, R)).rejects.toThrow(/no longer exists/i);
    await expect(deleteIntake(env, SHOP, entry.id, 'rlm-other')).rejects.toThrow(/no longer exists/i);
    expect(await listIntake(env, SHOP, R)).toHaveLength(1);
  });

  it('reports a missing entry rather than doing nothing quietly', async () => {
    await expect(deleteIntake(env, SHOP, 9999, R)).rejects.toThrow(/no longer exists/i);
  });
});
