/**
 * NOTHING CHANGED HANDS AT A PRICE OF 0.
 *
 * Market Analysis flags a shop for charging far more or far less than the realm
 * pays. That list had filled up with shops that had done nothing at all: three
 * ordinary acts leave a listing priced at NOTHING, and a listing at nothing has
 * a ratio of 0 against any value, so it was permanently and automatically below
 * the undercutting threshold.
 *
 *   • a HARVEST — a crop nobody was bought from, listed unpriced until its
 *     owner sets a price;
 *   • a STOCKTAKE — counting the shelves and finding something nobody had
 *     written down, which the index cannot price either;
 *   • a DELIVERY THAT COST 0 — a gift, a prop, a correction.
 *
 * What is asserted here is BOTH halves: those three stop generating flags, and
 * a shop that really is charging double or half still gets flagged. A filter
 * that quietly turned the feature off would look identical from the first half
 * alone.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { marketAnalysis } from '../src/market.js';
import { importItemIndex } from '../src/item-index.js';
import { encodeSaleItems } from '../src/sales.js';
import { recordIntakeLines, recordHarvest } from '../src/intake.js';
import { importStockText, upsertItem, listInventory } from '../src/inventory.js';
import { registerUser } from '../src/registry.js';

let env;
const R = DEFAULT_REALM_ID;
const SHOP = 'Iron Hearth';
const OTHER = 'Riverwood Trader';

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run();
  await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 30 }], R);
  await registerUser(env, { email: 'a@x.test', character: 'A', businessName: SHOP, asOwner: true, realmId: R });
  await registerUser(env, { email: 'b@x.test', character: 'B', businessName: OTHER, asOwner: true, realmId: R });
});

let n = 0;
/** A real sale, which is what gives the item a value to be judged against. */
const sale = (shop, qty, price) => env.DB.prepare(
  `INSERT INTO sales (realm_id, business, ts, order_no, hold, items, qty_total, total, status)
   VALUES (?, ?, '2026-01-01T00:00:00Z', ?, 'Whiterun', ?, ?, ?, 'OK')`)
  .bind(R, shop, 'S-' + (++n), encodeSaleItems([{ name: 'Iron Sword', qty, price }]), qty, qty * price).run();

/** The realm agrees a sword is worth 30, from trade nobody is disputing. */
const aMarket = () => sale(OTHER, 10, 30);

const flags = async () => {
  const d = await marketAnalysis(env, R);
  return {
    under: d.undercut.map((r) => r.business + '/' + r.item),
    over: d.overpriced.map((r) => r.business + '/' + r.item),
    belowCost: d.underpriced.map((r) => r.business + '/' + r.item),
    value: (d.items.find((i) => i.item === 'Iron Sword') || {}).avgValue,
  };
};
const priceOf = async (shop) =>
  ((await listInventory(env, shop, R)).find((i) => i.item === 'Iron Sword') || {}).price;

describe('a listing nobody has priced yet', () => {
  it('is not a shop undercutting the realm — a harvest', async () => {
    await aMarket();
    await recordHarvest(env, SHOP, { items: [{ item: 'Iron Sword', numItems: 5 }] }, R);
    // The listing really is unpriced — this is the state that used to flag.
    expect(await priceOf(SHOP)).toBe(0);
    expect((await flags()).under).toEqual([]);
  });

  /**
   * A stocktake prices what it finds from the master index, and at 0 when the
   * index has never heard of it either. The unpriced case only reaches the
   * anomaly list once SOMEBODY ELSE has traded the item — which is exactly the
   * situation: one shop sells cogs at 50, another counts some off a shelf, and
   * the second is flagged for undercutting a market it has not entered.
   */
  it('is not a shop undercutting the realm — a stocktake find', async () => {
    await importItemIndex(env, [{ name: 'Dwarven Cog', baseValue: 0 }], R);
    await env.DB.prepare(
      `INSERT INTO sales (realm_id, business, ts, order_no, hold, items, qty_total, total, status)
       VALUES (?, ?, '2026-01-01T00:00:00Z', 'S-COG', 'Whiterun', ?, 10, 500, 'OK')`)
      .bind(R, OTHER, encodeSaleItems([{ name: 'Dwarven Cog', qty: 10, price: 50 }])).run();

    await importStockText(env, SHOP, 'Iron Sword, 4', R, 'A');
    expect(await priceOf(SHOP)).toBe(30); // priced from the index where it can be…
    await importStockText(env, SHOP, 'Dwarven Cog, 4', R, 'A'); // …and 0 where it cannot
    expect((await listInventory(env, SHOP, R)).find((i) => i.item === 'Dwarven Cog').price).toBe(0);

    const d = await marketAnalysis(env, R);
    expect(d.items.find((i) => i.item === 'Dwarven Cog').avgValue).toBe(50); // the realm has a price
    expect((await flags()).under).toEqual([]);                               // the shelf is just unpriced
  });

  it('is not a shop undercutting the realm — a delivery that cost nothing', async () => {
    await aMarket();
    await recordIntakeLines(env, SHOP, {
      items: [{ item: 'Iron Sword', numItems: 5, pricePer: 0 }], vendor: 'A gift', hold: 'Whiterun',
    }, R);
    expect(await priceOf(SHOP)).toBe(0);
    expect((await flags()).under).toEqual([]);
  });

  /**
   * The same listing, priced. This is the control: the filter must be about the
   * price being ABSENT, not about the shop or the item.
   */
  it('IS flagged the moment its owner prices it far under the realm', async () => {
    await aMarket();
    await recordHarvest(env, SHOP, { items: [{ item: 'Iron Sword', numItems: 5 }] }, R);
    expect((await flags()).under).toEqual([]);
    await upsertItem(env, SHOP, { item: 'Iron Sword', price: 3 }, R); // a tenth of the realm's 30
    expect((await flags()).under).toEqual([SHOP + '/Iron Sword']);
  });

  it('still catches a shop charging far over the realm', async () => {
    await aMarket();
    await upsertItem(env, SHOP, { item: 'Iron Sword', price: 300 }, R);
    expect((await flags()).over).toEqual([SHOP + '/Iron Sword']);
  });
});

describe('what a price of 0 says about an item’s worth', () => {
  it('says nothing — a free delivery does not drag the valuation down', async () => {
    await aMarket();
    expect((await flags()).value).toBe(30);
    await recordIntakeLines(env, SHOP, {
      items: [{ item: 'Iron Sword', numItems: 100, pricePer: 0 }], vendor: 'A gift', hold: 'Whiterun',
    }, R);
    expect((await flags()).value).toBe(30);
  });

  /**
   * A sale rung up at 0 is the same act as an employee purchase — the goods
   * moved and nothing was charged — and the module already refuses to read that
   * as trade. It reached the valuation by this other door.
   */
  it('says nothing when the till rang up 0 either', async () => {
    await aMarket();
    await sale(SHOP, 100, 0);
    expect((await flags()).value).toBe(30);
  });

  it('leaves a real price alone, however small', async () => {
    await sale(OTHER, 10, 1);
    expect((await flags()).value).toBe(1);
  });
});

describe('selling below what it cost', () => {
  it('does not read a free crate as the cost of an item', async () => {
    await aMarket();
    // Bought twenty at 20 and given five, then listed at 15: a real loss.
    await recordIntakeLines(env, SHOP, {
      items: [{ item: 'Iron Sword', numItems: 20, pricePer: 20, salePrice: 15 }], vendor: 'Smith', hold: 'Whiterun',
    }, R);
    expect((await flags()).belowCost).toEqual([SHOP + '/Iron Sword']);

    // The free crate must not pull the average cost under the shelf price and
    // make the loss disappear.
    await recordIntakeLines(env, SHOP, {
      items: [{ item: 'Iron Sword', numItems: 20, pricePer: 0 }], vendor: 'A gift', hold: 'Whiterun',
    }, R);
    expect((await flags()).belowCost).toEqual([SHOP + '/Iron Sword']);
  });

  it('does not call an unpriced listing a loss', async () => {
    await recordIntakeLines(env, SHOP, {
      items: [{ item: 'Iron Sword', numItems: 20, pricePer: 20 }], vendor: 'Smith', hold: 'Whiterun',
    }, R);
    await upsertItem(env, SHOP, { item: 'Iron Sword', price: 0 }, R);
    expect(await priceOf(SHOP)).toBe(0);
    expect((await flags()).belowCost).toEqual([]);
  });
});
