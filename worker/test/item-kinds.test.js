/**
 * ITEM KINDS, and the specials that ask for them.
 *
 * Two halves of one feature. A shop says what its stock IS — food, drink, a
 * weapon — on its own listings; a special then asks for five food and five
 * drink rather than naming five items, and the customer chooses at the till.
 *
 * What has to hold:
 *   • a tag is the LISTING's, stored one way (lowercase) so it compares by one
 *     rule, and a shop tagging its stock never touches another's;
 *   • the till chooses WHAT and the Worker states the PRICE — a choice that
 *     does not match the deal is refused, not quietly re-priced;
 *   • the sale records the SPECIAL with what was actually taken, so the
 *     stockroom, a later void, and the market analysis all still agree.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { listInventory, upsertItem, setItemTag, parseTags, encodeTags } from '../src/inventory.js';
import { saveBundle, listBundles } from '../src/bundles.js';
import { checkout, voidSale } from '../src/sales.js';
import { importItemIndex } from '../src/item-index.js';
import { readRealmPrefs, writeRealmPrefs } from '../src/realm-prefs.js';

let env;
const R = DEFAULT_REALM_ID;
const SHOP = 'The Tavern';
const caller = { uid: 'u-1', character: 'Tess', email: 't@x.com' };

const stockOf = async (item) => (await env.DB.prepare(
  'SELECT stock FROM inventory WHERE realm_id = ? AND business = ? AND item = ?').bind(R, SHOP, item).first()).stock;
const ring = (cart, opts) => checkout(env, SHOP, caller, { cart, hold: 'Whiterun', ...opts }, R);
const tagsOf = async (item) => (await listInventory(env, SHOP, R)).find((i) => i.item === item).tags;

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run();
  await env.DB.prepare("INSERT INTO companies (id, business, perpetual, status, realm_id) VALUES ('c1', ?, 1, 'VALID', ?)")
    .bind(SHOP, R).run();
  await importItemIndex(env, [
    { name: 'Ale', baseValue: 4 }, { name: 'Mead', baseValue: 6 },
    { name: 'Stew', baseValue: 9 }, { name: 'Sweet Roll', baseValue: 3 },
    { name: 'Iron Sword', baseValue: 25 },
  ], R);
  for (const [item, price, stock, tags] of [
    ['Ale', 5, 100, 'drink'],
    ['Mead', 7, 100, 'drink'],
    ['Stew', 10, 100, 'food'],
    ['Sweet Roll', 4, 100, 'food'],
    ['Iron Sword', 30, 5, 'weapon'],
  ]) {
    await env.DB.prepare(
      'INSERT INTO inventory (realm_id, business, item, price, stock, low_stock, tags) VALUES (?, ?, ?, ?, ?, 0, ?)')
      .bind(R, SHOP, item, price, stock, tags).run();
  }
  await saveBundle(env, SHOP, {
    name: 'Tavern Night', price: 40, needs: [{ tag: 'food', qty: 2 }, { tag: 'drink', qty: 2 }],
  }, R);
});

describe('the realm names the kinds', () => {
  it('ships Skyrim’s own to begin with, so a new realm can tag on day one', async () => {
    const prefs = await readRealmPrefs(env, R);
    expect(prefs.itemTags).toContain('Food');
    expect(prefs.itemTags).toContain('Drink');
  });

  it('deduplicates, trims, and refuses a comma — the listing stores them comma-joined', async () => {
    const prefs = await writeRealmPrefs(env, { itemTags: ['Food', ' food ', 'Drink,Mead', ''] }, R);
    expect(prefs.itemTags).toEqual(['Food', 'Drink Mead']);
  });

  it('is per realm, like every other preference', async () => {
    await writeRealmPrefs(env, { itemTags: ['Rations'] }, R);
    expect((await readRealmPrefs(env, 'rlm-2')).itemTags).toContain('Food');
  });
});

describe('tagging a listing', () => {
  it('stores one way — lowercase, trimmed, deduplicated', () => {
    expect(encodeTags([' Food ', 'FOOD', 'drink'])).toBe('food,drink');
    expect(parseTags('food, drink ,')).toEqual(['food', 'drink']);
  });

  it('is left ALONE by a save that says nothing about kinds', async () => {
    await upsertItem(env, SHOP, { item: 'Ale', price: 6, lowStock: 0 }, R);
    expect(await tagsOf('Ale')).toEqual(['drink']);
  });

  it('is replaced by a save that does', async () => {
    await upsertItem(env, SHOP, { item: 'Ale', price: 6, lowStock: 0, tags: ['drink', 'potion'] }, R);
    expect(await tagsOf('Ale')).toEqual(['drink', 'potion']);
  });

  /**
   * The bulk screen answers a question about the whole shop — "which of these
   * are food?" — so what it does NOT name loses the tag. That is the answer,
   * not an addition to it.
   */
  it('takes the kind off what the bulk answer leaves out', async () => {
    await setItemTag(env, SHOP, { tag: 'food', items: ['Stew'] }, R);
    expect(await tagsOf('Stew')).toEqual(['food']);
    expect(await tagsOf('Sweet Roll')).toEqual([]);
  });

  it('leaves every OTHER kind on every row untouched', async () => {
    await upsertItem(env, SHOP, { item: 'Stew', price: 10, lowStock: 0, tags: ['food', 'hot'] }, R);
    await setItemTag(env, SHOP, { tag: 'food', items: [] }, R);
    expect(await tagsOf('Stew')).toEqual(['hot']);
  });

  it('never reaches another shop', async () => {
    await env.DB.prepare(
      'INSERT INTO inventory (realm_id, business, item, price, stock, low_stock, tags) VALUES (?, ?, ?, ?, ?, 0, ?)')
      .bind(R, 'Other Shop', 'Ale', 5, 10, 'drink').run();
    await setItemTag(env, SHOP, { tag: 'drink', items: [] }, R);
    const theirs = await listInventory(env, 'Other Shop', R);
    expect(theirs[0].tags).toEqual(['drink']);
  });
});

describe('a special that asks for kinds', () => {
  it('stores what it asks for, and counts the items it takes', async () => {
    const [b] = await listBundles(env, SHOP, R);
    expect(b.needs).toEqual([{ tag: 'food', qty: 2 }, { tag: 'drink', qty: 2 }]);
    expect(b.parts).toEqual([]);
    expect(b.units).toBe(4);
  });

  it('is one or the other — a special cannot both name items and ask for kinds', async () => {
    await expect(saveBundle(env, SHOP, {
      name: 'Muddle', price: 10, parts: [{ item: 'Ale', qty: 1 }], needs: [{ tag: 'food', qty: 1 }],
    }, R)).rejects.toThrow(/names its items or asks for kinds/i);
  });

  it('refuses the same kind twice — ask once, with the full number', async () => {
    await expect(saveBundle(env, SHOP, {
      name: 'Double', price: 10, needs: [{ tag: 'food', qty: 1 }, { tag: 'Food', qty: 2 }],
    }, R)).rejects.toThrow(/twice/i);
  });
});

describe('filling one at the till', () => {
  const fill = (parts) => ring([{ bundle: 'Tavern Night', qty: 1, parts }]);

  it('rings up at the SPECIAL’s price, whatever the items are worth', async () => {
    const res = await fill([
      { item: 'Stew', qty: 2, tag: 'food' },
      { item: 'Ale', qty: 2, tag: 'drink' },
    ]);
    // Separately: 2×10 + 2×5 = 30. The deal says 40, and the deal wins.
    expect(res.total).toBe(40);
  });

  it('takes exactly what was chosen off the shelf', async () => {
    await fill([
      { item: 'Sweet Roll', qty: 2, tag: 'food' },
      { item: 'Mead', qty: 1, tag: 'drink' },
      { item: 'Ale', qty: 1, tag: 'drink' },
    ]);
    expect(await stockOf('Sweet Roll')).toBe(98);
    expect(await stockOf('Mead')).toBe(99);
    expect(await stockOf('Ale')).toBe(99);
    expect(await stockOf('Stew')).toBe(100);
  });

  it('counts the UNITS that moved, not the number of specials', async () => {
    const res = await fill([
      { item: 'Stew', qty: 2, tag: 'food' },
      { item: 'Ale', qty: 2, tag: 'drink' },
    ]);
    const row = await env.DB.prepare('SELECT qty_total FROM sales WHERE order_no = ?').bind(res.orderNo).first();
    expect(row.qty_total).toBe(4);
  });

  it('records the SPECIAL, with what was taken riding along', async () => {
    const res = await fill([
      { item: 'Stew', qty: 2, tag: 'food' },
      { item: 'Ale', qty: 2, tag: 'drink' },
    ]);
    const row = await env.DB.prepare('SELECT items FROM sales WHERE order_no = ?').bind(res.orderNo).first();
    const [line] = JSON.parse(row.items);
    expect(line.name).toBe('Tavern Night');
    expect(line.parts).toEqual([{ item: 'Stew', qty: 2 }, { item: 'Ale', qty: 2 }]);
  });

  it('puts back what was actually taken when it is voided', async () => {
    const res = await fill([
      { item: 'Sweet Roll', qty: 2, tag: 'food' },
      { item: 'Mead', qty: 2, tag: 'drink' },
    ]);
    await voidSale(env, SHOP, res.orderNo, R);
    expect(await stockOf('Sweet Roll')).toBe(100);
    expect(await stockOf('Mead')).toBe(100);
  });

  it('refuses too few', async () => {
    await expect(fill([
      { item: 'Stew', qty: 1, tag: 'food' },
      { item: 'Ale', qty: 2, tag: 'drink' },
    ])).rejects.toThrow(/takes 2 food/i);
  });

  it('refuses too many — five for the price of four is not the deal', async () => {
    await expect(fill([
      { item: 'Stew', qty: 3, tag: 'food' },
      { item: 'Ale', qty: 2, tag: 'drink' },
    ])).rejects.toThrow(/takes 2 food/i);
  });

  it('refuses an item that is not tagged that kind', async () => {
    await expect(fill([
      { item: 'Iron Sword', qty: 2, tag: 'food' },
      { item: 'Ale', qty: 2, tag: 'drink' },
    ])).rejects.toThrow(/not tagged "food"/i);
  });

  /**
   * An item tagged both must not pay for both halves. Each choice names the
   * part of the deal it fills, and the tally is per part.
   */
  it('will not let one item fill two parts of the deal at once', async () => {
    await upsertItem(env, SHOP, { item: 'Mead', price: 7, lowStock: 0, tags: ['food', 'drink'] }, R);
    await expect(fill([{ item: 'Mead', qty: 2, tag: 'drink' }])).rejects.toThrow(/takes 2 food/i);
    // Named against both parts, it is two units each and four in all.
    const res = await fill([
      { item: 'Mead', qty: 2, tag: 'food' },
      { item: 'Mead', qty: 2, tag: 'drink' },
    ]);
    expect(res.total).toBe(40);
    expect(await stockOf('Mead')).toBe(96);
  });

  it('refuses something the deal never asked for', async () => {
    await expect(fill([
      { item: 'Stew', qty: 2, tag: 'food' },
      { item: 'Ale', qty: 2, tag: 'drink' },
      { item: 'Iron Sword', qty: 1, tag: 'weapon' },
    ])).rejects.toThrow(/does not ask for anything tagged "weapon"/i);
  });

  it('refuses an ingredient, the way every other sale does', async () => {
    await upsertItem(env, SHOP, { item: 'Stew', price: 10, lowStock: 0, ingredient: true, tags: ['food'] }, R);
    await expect(fill([
      { item: 'Stew', qty: 2, tag: 'food' },
      { item: 'Ale', qty: 2, tag: 'drink' },
    ])).rejects.toThrow(/ingredient/i);
  });

  it('refuses an item the shop does not list — a kind lives on the listing', async () => {
    await expect(fill([
      { item: 'Venison', qty: 2, tag: 'food' },
      { item: 'Ale', qty: 2, tag: 'drink' },
    ])).rejects.toThrow(/not in your inventory/i);
  });

  it('will not sell stock that is not there', async () => {
    await expect(ring([{ bundle: 'Tavern Night', qty: 1, parts: [
      { item: 'Iron Sword', qty: 2, tag: 'food' },
    ] }])).rejects.toThrow(/not tagged/i);
  });

  /**
   * A stored line's parts are PER UNIT of the special, and two fillings need
   * not divide evenly — so two specials are two lines, each with what its own
   * customer chose.
   */
  it('goes in one at a time', async () => {
    await expect(ring([{ bundle: 'Tavern Night', qty: 2, parts: [
      { item: 'Stew', qty: 4, tag: 'food' },
      { item: 'Ale', qty: 4, tag: 'drink' },
    ] }])).rejects.toThrow(/one at a time/i);
  });

  it('takes an empty choice as a question, not an answer', async () => {
    await expect(ring([{ bundle: 'Tavern Night', qty: 1 }])).rejects.toThrow(/Choose what goes in/i);
  });
});

/**
 * A SPECIAL PRICED AS A PERCENTAGE OFF ITS OWN ITEMS.
 *
 * A suit of armour at 10% off the armour — and nothing else in the order
 * touched, which is the whole difference between this and the order-level
 * discount. There is no stored figure: the price is worked out at the till from
 * what the shop charges that day, so repricing a piece moves the deal with it.
 */
describe('a special priced by percentage', () => {
  beforeEach(async () => {
    await saveBundle(env, SHOP, {
      name: 'Full Kit', price: 0, percentOff: 10,
      parts: [{ item: 'Iron Sword', qty: 1 }, { item: 'Stew', qty: 2 }],
    }, R);
  });

  it('stores the percentage and no price', async () => {
    const b = (await listBundles(env, SHOP, R)).find((x) => x.name === 'Full Kit');
    expect(b).toMatchObject({ percentOff: 10, price: 0 });
  });

  it('is one or the other — a flat price is cleared when a percentage is set', async () => {
    await saveBundle(env, SHOP, { name: 'Full Kit', price: 99, percentOff: 25, parts: [{ item: 'Stew', qty: 1 }] }, R);
    const b = (await listBundles(env, SHOP, R)).find((x) => x.name === 'Full Kit');
    expect(b).toMatchObject({ percentOff: 25, price: 0 });
  });

  it('refuses a percentage that is not one', async () => {
    await expect(saveBundle(env, SHOP, {
      name: 'Nonsense', percentOff: 140, parts: [{ item: 'Stew', qty: 1 }],
    }, R)).rejects.toThrow(/between 0 and 100/i);
  });

  it('charges the shop’s own prices, less the percentage', async () => {
    // Iron Sword 30 + 2 × Stew 10 = 50, less 10% = 45.
    const res = await ring([{ bundle: 'Full Kit', qty: 1 }]);
    expect(res.total).toBe(45);
  });

  it('FOLLOWS a reprice, because there is no stored figure to go stale', async () => {
    await upsertItem(env, SHOP, { item: 'Iron Sword', price: 40, lowStock: 0 }, R);
    const res = await ring([{ bundle: 'Full Kit', qty: 1 }]);
    expect(res.total).toBe(54); // (40 + 20) less 10%
  });

  it('leaves the rest of the order at full price', async () => {
    const res = await ring([
      { bundle: 'Full Kit', qty: 1 },
      { item: 'Ale', qty: 2, price: 5 },
    ]);
    expect(res.total).toBe(55); // 45 for the kit, 10 for the ales, untouched
  });

  it('takes its items off the shelf like any other special', async () => {
    await ring([{ bundle: 'Full Kit', qty: 2 }]);
    expect(await stockOf('Iron Sword')).toBe(3);
    expect(await stockOf('Stew')).toBe(96);
  });

  it('rounds ONCE, at the total — not per line', async () => {
    await upsertItem(env, SHOP, { item: 'Stew', price: 10.5, lowStock: 0, tags: ['food'] }, R);
    // Sword 30 + 2 × 10.5 = 51, less 10% = 45.9 → 45 taken, not 45 from a
    // pre-floored 45.
    const res = await ring([{ bundle: 'Full Kit', qty: 1 }]);
    expect(res.total).toBe(45);
  });

  it('refuses an item it cannot price — there is nothing to take a tenth off', async () => {
    await saveBundle(env, SHOP, {
      name: 'Ghost Kit', percentOff: 10, parts: [{ item: 'Dragonbone Axe', qty: 1 }],
    }, R);
    await expect(ring([{ bundle: 'Ghost Kit', qty: 1 }]))
      .rejects.toThrow(/not in your inventory/i);
  });

  /** The two features meet: a by-kind special can be priced this way too. */
  it('works on a special that asks for kinds, over what the customer chose', async () => {
    await saveBundle(env, SHOP, {
      name: 'Round of Drinks', percentOff: 50, needs: [{ tag: 'drink', qty: 2 }],
    }, R);
    const res = await ring([{ bundle: 'Round of Drinks', qty: 1, parts: [
      { item: 'Mead', qty: 2, tag: 'drink' }, // 7 each = 14, less half = 7
    ] }]);
    expect(res.total).toBe(7);
  });
});
