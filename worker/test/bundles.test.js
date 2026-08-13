/**
 * BUNDLES — several items sold together for one price.
 *
 * The interesting parts are all about the gap between what a bundle IS (one
 * line, one price) and what it DOES (takes several different things off the
 * shelf). Everything that walks a sale afterwards has to see through that: the
 * stock check, the void that puts it back, and the market analysis that must not
 * mistake a bundle for an item.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { listBundles, saveBundle, deleteBundle, findBundle } from '../src/bundles.js';
import { checkout, voidSale, parseSaleItems, encodeSaleItems } from '../src/sales.js';
import { importItemIndex } from '../src/item-index.js';
import { marketAnalysis } from '../src/market.js';
import { cofferBalance } from '../src/coffers.js';

let env;
const R = DEFAULT_REALM_ID;
const SHOP = 'The Tavern';
const caller = { uid: 'u-1', character: 'Tess', email: 't@x.com' };

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run();
  await env.DB.prepare("INSERT INTO companies (id, business, perpetual, status, realm_id) VALUES ('c1', ?, 1, 'VALID', ?)")
    .bind(SHOP, R).run();
  await importItemIndex(env, [{ name: 'Ale', baseValue: 4 }, { name: 'Stew', baseValue: 9 }], R);
  for (const [item, price, stock] of [['Ale', 5, 100], ['Stew', 10, 100]]) {
    await env.DB.prepare('INSERT INTO inventory (realm_id, business, item, price, stock, low_stock) VALUES (?, ?, ?, ?, ?, 0)')
      .bind(R, SHOP, item, price, stock).run();
  }
  await saveBundle(env, SHOP, { name: 'Feast', price: 60, parts: [{ item: 'Ale', qty: 5 }, { item: 'Stew', qty: 5 }] }, R);
});

const stockOf = async (item) => (await env.DB.prepare(
  'SELECT stock FROM inventory WHERE realm_id = ? AND business = ? AND item = ?').bind(R, SHOP, item).first()).stock;
const saleRow = (orderNo) => env.DB.prepare('SELECT * FROM sales WHERE order_no = ?').bind(orderNo).first();
const ring = (cart, opts) => checkout(env, SHOP, caller, { cart, hold: 'Whiterun', ...opts }, R);

describe('setting one up', () => {
  it('stores its parts and its own price', async () => {
    const [b] = await listBundles(env, SHOP, R);
    expect(b).toMatchObject({ name: 'Feast', price: 60, units: 10 });
    expect(b.parts).toEqual([{ item: 'Ale', qty: 5 }, { item: 'Stew', qty: 5 }]);
  });

  it('REPLACES one of the same name rather than refusing — a deal gets tuned', async () => {
    await saveBundle(env, SHOP, { name: 'Feast', price: 45, parts: [{ item: 'Ale', qty: 3 }] }, R);
    const all = await listBundles(env, SHOP, R);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ price: 45, units: 3 });
  });

  it('refuses an empty one, and the same item twice', async () => {
    await expect(saveBundle(env, SHOP, { name: 'Empty', price: 5, parts: [] }, R)).rejects.toThrow(/at least one item/);
    await expect(saveBundle(env, SHOP, { name: 'Dup', price: 5, parts: [{ item: 'Ale', qty: 1 }, { item: 'ale', qty: 2 }] }, R))
      .rejects.toThrow(/twice/);
  });

  it('refuses a nameless one and a negative price', async () => {
    await expect(saveBundle(env, SHOP, { name: ' ', price: 5, parts: [{ item: 'Ale', qty: 1 }] }, R)).rejects.toThrow(/name/);
    await expect(saveBundle(env, SHOP, { name: 'Bad', price: -1, parts: [{ item: 'Ale', qty: 1 }] }, R)).rejects.toThrow(/0 or more/);
  });

  it('finds one however it is capitalised, and never another realm’s', async () => {
    expect((await findBundle(env, SHOP, 'fEaSt', R)).price).toBe(60);
    expect(await findBundle(env, SHOP, 'Feast', 'rlm-other')).toBe(null);
  });

  it('deletes cleanly', async () => {
    const [b] = await listBundles(env, SHOP, R);
    expect(await deleteBundle(env, SHOP, b.id, R)).toEqual([]);
  });
});

describe('selling one', () => {
  it('charges the BUNDLE’S price, not the sum of its parts', async () => {
    const res = await ring([{ bundle: 'Feast', qty: 1 }]);
    // Separately these are 5×5 + 5×10 = 75. The bundle is 60.
    expect(res.total).toBe(60);
    expect((await saleRow(res.orderNo)).total).toBe(60);
  });

  it('takes every part off the shelf', async () => {
    await ring([{ bundle: 'Feast', qty: 1 }]);
    expect(await stockOf('Ale')).toBe(95);
    expect(await stockOf('Stew')).toBe(95);
  });

  it('multiplies the parts by how many bundles were sold', async () => {
    const res = await ring([{ bundle: 'Feast', qty: 3 }]);
    expect(res.total).toBe(180);
    expect(await stockOf('Ale')).toBe(85);
    expect(await stockOf('Stew')).toBe(85);
  });

  it('counts the UNITS that moved, not the number of bundles', async () => {
    const res = await ring([{ bundle: 'Feast', qty: 2 }]);
    expect((await saleRow(res.orderNo)).qty_total).toBe(20); // 2 × (5 + 5)
  });

  it('will not sell one the shop cannot cover', async () => {
    await env.DB.prepare('UPDATE inventory SET stock = 4 WHERE item = ?').bind('Ale').run();
    await expect(ring([{ bundle: 'Feast', qty: 1 }])).rejects.toThrow(/Not enough stock for Ale/);
    expect(await stockOf('Stew'), 'nothing moves when it is refused').toBe(100);
  });

  it('ignores a price the client tries to name for it', async () => {
    const res = await ring([{ bundle: 'Feast', qty: 1, price: 1 }]);
    expect(res.total).toBe(60);
  });

  it('refuses a bundle this shop does not have', async () => {
    await expect(ring([{ bundle: 'Nonesuch', qty: 1 }])).rejects.toThrow(/not one of this shop/);
  });

  it('refuses one holding an ingredient — that is stock to craft with', async () => {
    await env.DB.prepare('UPDATE inventory SET ingredient = 1 WHERE item = ?').bind('Stew').run();
    await expect(ring([{ bundle: 'Feast', qty: 1 }])).rejects.toThrow(/marked as an ingredient/);
  });

  it('mixes with ordinary lines in one cart', async () => {
    const res = await ring([{ bundle: 'Feast', qty: 1 }, { item: 'Ale', qty: 2, price: 5 }]);
    expect(res.total).toBe(70);
    expect(await stockOf('Ale')).toBe(93);
  });

  it('takes a discount on the whole order like anything else', async () => {
    const res = await ring([{ bundle: 'Feast', qty: 1 }], { discountPercent: 50 });
    expect(res.total).toBe(30);
  });

  it('credits the coffer with what was actually taken', async () => {
    await ring([{ bundle: 'Feast', qty: 1 }]);
    expect(await cofferBalance(env, SHOP, R)).toBe(60);
  });
});

describe('voiding one', () => {
  it('puts the PARTS back, not a phantom item named after the bundle', async () => {
    const res = await ring([{ bundle: 'Feast', qty: 2 }]);
    expect(await stockOf('Ale')).toBe(90);
    await voidSale(env, SHOP, res.orderNo, R);
    expect(await stockOf('Ale')).toBe(100);
    expect(await stockOf('Stew')).toBe(100);
    // …and no listing was invented for the bundle itself.
    const ghost = await env.DB.prepare('SELECT 1 FROM inventory WHERE item = ?').bind('Feast').first();
    expect(ghost).toBe(null);
  });

  it('reverses the coffer too', async () => {
    const res = await ring([{ bundle: 'Feast', qty: 1 }]);
    await voidSale(env, SHOP, res.orderNo, R);
    expect(await cofferBalance(env, SHOP, R)).toBe(0);
  });

  it('still works for a sale recorded before bundles existed', async () => {
    // An old row: plain lines, no parts anywhere.
    const res = await ring([{ item: 'Ale', qty: 2, price: 5 }]);
    await voidSale(env, SHOP, res.orderNo, R);
    expect(await stockOf('Ale')).toBe(100);
  });
});

describe('what a bundle is NOT', () => {
  it('never becomes an item in the realm’s index', async () => {
    await ring([{ bundle: 'Feast', qty: 1 }]);
    const row = await env.DB.prepare('SELECT 1 FROM master_item WHERE name = ?').bind('Feast').first();
    expect(row).toBe(null);
  });

  it('does not pretend to be evidence of what an item is worth', async () => {
    await ring([{ bundle: 'Feast', qty: 1 }]);
    // The bundle's own line is not an index item, so it values nothing. Ale's
    // worth is not quietly restated as a share of a deal price.
    const items = (await marketAnalysis(env, R)).items;
    expect(items.map((i) => i.item)).not.toContain('Feast');
    expect(items.find((i) => i.item === 'Ale')).toBe(undefined);
  });

  it('survives the trip through the sale’s stored form', () => {
    const line = { name: 'Feast', qty: 2, price: 60, parts: [{ item: 'Ale', qty: 5 }] };
    const back = parseSaleItems(encodeSaleItems([line])).lines[0];
    expect(back).toEqual(line);
  });

  it('leaves an ordinary line’s stored form exactly as it was', () => {
    const back = parseSaleItems(encodeSaleItems([{ name: 'Ale', qty: 1, price: 5 }])).lines[0];
    expect(back).toEqual({ name: 'Ale', qty: 1, price: 5 });
    expect('parts' in back).toBe(false);
  });
});
