/**
 * Intake: the sale price an owner sets, and undoing a mistyped delivery.
 *
 * The listing is a PRICE LIST, not a claim to be holding stock — so nothing
 * here may remove an item just because its count reached zero.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { recordIntake, recordIntakeLines, recordHarvest, listIntake, deleteIntake, HARVEST_VENDOR } from '../src/intake.js';
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

/**
 * Ingredients: stock a shop holds to craft with and does not sell.
 *
 * It is a property of the SHOP'S LISTING, not of the item — one shop's
 * ingredient is another's stock-in-trade — so it lives on the inventory row.
 */
describe('ingredients', () => {
  it('are flagged on the listing when taken in as one', async () => {
    await take({ ingredient: true });
    expect(await itemRow('Iron Sword')).toMatchObject({ ingredient: true, stock: 10 });
  });

  it('are ordinary stock by default', async () => {
    await take({});
    expect((await itemRow('Iron Sword')).ingredient).toBe(false);
  });

  it('can be turned back into sellable stock by a delivery that SAYS SO', async () => {
    // Explicitly, not by omission. A delivery that does not mention the flag
    // leaves it alone — see "a restock updates the listing you already have".
    await take({ ingredient: true });
    await take({ ingredient: false, salePrice: 30 });
    const row = await itemRow('Iron Sword');
    expect(row.ingredient).toBe(false);
    expect(row.price).toBe(30);
  });

  it('are one shop\'s business only', async () => {
    await take({ ingredient: true });
    await recordIntake(env, 'Rival Traders', { item: 'Iron Sword', numItems: 5, pricePer: 5, salePrice: 40 }, R);
    expect((await itemRow('Iron Sword')).ingredient).toBe(true);
    const rival = (await listInventory(env, 'Rival Traders', R)).find((i) => i.item === 'Iron Sword');
    expect(rival).toMatchObject({ ingredient: false, price: 40 });
  });
});

/**
 * "Bought from" — which REGISTERED company supplied a delivery.
 *
 * The vendor field stays free text because most suppliers are NPCs with no
 * account. This is the joinable half: it is what lets a region credit the shop
 * that actually sold the goods, rather than only counting the total.
 */
describe('the supplying company', () => {
  beforeEach(async () => {
    await env.DB.prepare(
      `INSERT INTO companies (id, realm_id, business, hold, court, priority, perpetual, status)
       VALUES ('co-a', ?, ?, 'Whiterun', 0, 0, 1, 'VALID'), ('co-b', ?, 'Rift Traders', 'The Rift', 0, 0, 1, 'VALID')`)
      .bind(R, SHOP, R).run();
  });

  it('is recorded when the supplier is a registered shop', async () => {
    await take({ fromBusiness: 'Rift Traders' });
    expect((await listIntake(env, SHOP, R))[0].fromBusiness).toBe('Rift Traders');
  });

  it('is empty for an ordinary NPC vendor', async () => {
    await take({});
    expect((await listIntake(env, SHOP, R))[0].fromBusiness).toBe('');
  });

  it('resolves loosely to the company\'s real name', async () => {
    await take({ fromBusiness: '  rift traders ' });
    expect((await listIntake(env, SHOP, R))[0].fromBusiness).toBe('Rift Traders');
  });

  it('refuses a company that is not registered here', async () => {
    await expect(take({ fromBusiness: 'Ghost Emporium' })).rejects.toThrow(/no registered company/i);
  });

  it('refuses a shop recording a purchase from itself', async () => {
    await expect(take({ fromBusiness: SHOP })).rejects.toThrow(/from itself/i);
  });

  it('does not resolve a company in another realm', async () => {
    await env.DB.prepare(
      `INSERT INTO companies (id, realm_id, business, hold, court, priority, perpetual, status)
       VALUES ('co-x', 'rlm-other', 'Far Traders', 'Elsewhere', 0, 0, 1, 'VALID')`).run();
    await expect(take({ fromBusiness: 'Far Traders' })).rejects.toThrow(/no registered company/i);
  });
});

/**
 * Two ways a delivery used to fail to update what the owner was looking at.
 * Both were reported as "I entered the intake and nothing changed", and both
 * were real: one wrote to a row nobody could see, the other silently undid a
 * setting.
 */
describe('a restock updates the listing you already have', () => {
  it('adds to the existing item however the name is cased', async () => {
    // The inventory's uniqueness is on the raw name, so "iron sword" and "Iron
    // Sword" were two rows — the stock went up on the one nobody was looking at.
    await recordIntake(env, SHOP, { item: 'Iron Sword', numItems: 5, pricePer: 10 }, R);
    await recordIntake(env, SHOP, { item: 'iron sword', numItems: 4, pricePer: 10 }, R);
    const inv = await listInventory(env, SHOP, R);
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ item: 'Iron Sword', stock: 9 });
  });

  it('keeps the listing under its ORIGINAL spelling', async () => {
    await recordIntake(env, SHOP, { item: 'Iron Sword', numItems: 1, pricePer: 10 }, R);
    await recordIntake(env, SHOP, { item: 'IRON SWORD', numItems: 1, pricePer: 10 }, R);
    expect((await listInventory(env, SHOP, R))[0].item).toBe('Iron Sword');
  });

  it('does not clear the Ingredient flag on an ordinary restock', async () => {
    // The flag is set in the item editor and the delivery form's checkbox
    // defaults to off — so every restock was quietly making an ingredient
    // sellable again, back into the register and the pricing statistics.
    await recordIntake(env, SHOP, { item: 'Nirnroot', numItems: 5, pricePer: 2, ingredient: true }, R);
    expect((await listInventory(env, SHOP, R))[0].ingredient).toBe(true);
    await recordIntake(env, SHOP, { item: 'Nirnroot', numItems: 3, pricePer: 2 }, R);
    expect((await listInventory(env, SHOP, R))[0]).toMatchObject({ stock: 8, ingredient: true });
  });

  it('still lets a delivery SET the flag when it says so', async () => {
    await recordIntake(env, SHOP, { item: 'Nirnroot', numItems: 5, pricePer: 2 }, R);
    expect((await listInventory(env, SHOP, R))[0].ingredient).toBe(false);
    await recordIntake(env, SHOP, { item: 'Nirnroot', numItems: 1, pricePer: 2, ingredient: true }, R);
    expect((await listInventory(env, SHOP, R))[0].ingredient).toBe(true);
  });

  it('and can still turn it off explicitly', async () => {
    await recordIntake(env, SHOP, { item: 'Nirnroot', numItems: 5, pricePer: 2, ingredient: true }, R);
    await recordIntake(env, SHOP, { item: 'Nirnroot', numItems: 1, pricePer: 2, ingredient: false }, R);
    expect((await listInventory(env, SHOP, R))[0].ingredient).toBe(false);
  });
});

/**
 * FARM / HARVEST — stock produced rather than bought.
 *
 * The point of a separate verb: nobody was paid. Recording these as an intake
 * at 0 lied twice — it invented a purchase from an empty vendor, and a free
 * thing looks to the market like a thing worth nothing.
 */
describe('farm / harvest', () => {
  it('adds stock and takes nothing from the coffer', async () => {
    await recordHarvest(env, SHOP, { item: 'Wheat', numItems: 20 }, R);
    expect((await listInventory(env, SHOP, R))[0]).toMatchObject({ item: 'Wheat', stock: 20 });
    expect(await cofferBalance(env, SHOP, R)).toBe(0);
  });

  it('records no purchase price, so it cannot drag the item\'s value down', async () => {
    await recordHarvest(env, SHOP, { item: 'Wheat', numItems: 20 }, R);
    const [entry] = await listIntake(env, SHOP, R);
    expect(entry).toMatchObject({ item: 'Wheat', numItems: 20, pricePer: 0 });
  });

  it('is labelled as a harvest in the delivery log', async () => {
    await recordHarvest(env, SHOP, { item: 'Wheat', numItems: 5 }, R);
    expect((await listIntake(env, SHOP, R))[0].vendor).toBe(HARVEST_VENDOR);
  });

  it('adds to an existing listing however the name is cased', async () => {
    await recordIntake(env, SHOP, { item: 'Wheat', numItems: 5, pricePer: 2 }, R);
    await recordHarvest(env, SHOP, { item: 'wheat', numItems: 10 }, R);
    const inv = await listInventory(env, SHOP, R);
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ item: 'Wheat', stock: 15 });
  });

  it('never re-prices what it lands on', async () => {
    // A harvest is free; letting it write a price would zero the sale price of
    // anything the shop also buys.
    await recordIntake(env, SHOP, { item: 'Wheat', numItems: 5, pricePer: 2, salePrice: 9 }, R);
    await recordHarvest(env, SHOP, { item: 'Wheat', numItems: 10 }, R);
    expect((await listInventory(env, SHOP, R))[0].price).toBe(9);
  });

  it('leaves an existing Ingredient flag alone', async () => {
    await recordIntake(env, SHOP, { item: 'Nirnroot', numItems: 1, pricePer: 2, ingredient: true }, R);
    await recordHarvest(env, SHOP, { item: 'Nirnroot', numItems: 9 }, R);
    expect((await listInventory(env, SHOP, R))[0]).toMatchObject({ stock: 10, ingredient: true });
  });

  it('refuses nothing and refuses none', async () => {
    await expect(recordHarvest(env, SHOP, { item: '', numItems: 5 }, R)).rejects.toThrow(/which item/i);
    await expect(recordHarvest(env, SHOP, { item: 'Wheat', numItems: 0 }, R)).rejects.toThrow(/1 or more/i);
  });

  it('is idempotent on a repeated key', async () => {
    await recordHarvest(env, SHOP, { item: 'Wheat', numItems: 5, idempotencyKey: 'h1' }, R);
    await recordHarvest(env, SHOP, { item: 'Wheat', numItems: 5, idempotencyKey: 'h1' }, R);
    expect((await listInventory(env, SHOP, R))[0].stock).toBe(5);
  });
});

/** What an ingredient COSTS — the number you need when you go to buy more. */
describe('what a shop pays for its ingredients', () => {
  it('averages its own deliveries, weighted by quantity', async () => {
    // 10 at 2 and 90 at 4 is 3.8, not the 3 a plain mean of the two would give.
    await recordIntake(env, SHOP, { item: 'Nirnroot', numItems: 10, pricePer: 2, ingredient: true }, R);
    await recordIntake(env, SHOP, { item: 'Nirnroot', numItems: 90, pricePer: 4 }, R);
    expect((await listInventory(env, SHOP, R))[0].avgCost).toBe(3.8);
  });

  it('leaves harvested stock out of the average', async () => {
    await recordIntake(env, SHOP, { item: 'Nirnroot', numItems: 10, pricePer: 4, ingredient: true }, R);
    await recordHarvest(env, SHOP, { item: 'Nirnroot', numItems: 90 }, R);
    expect((await listInventory(env, SHOP, R))[0].avgCost).toBe(4);
  });

  it('is null, not zero, when nothing has ever been bought', async () => {
    await recordHarvest(env, SHOP, { item: 'Wheat', numItems: 5 }, R);
    expect((await listInventory(env, SHOP, R))[0].avgCost).toBe(null);
  });
});

/**
 * A DELIVERY IS ONE TRIP, and a trip brings back a crate.
 *
 * The rules that matter are about the delivery landing WHOLE: every line is
 * checked before any of it is written, the supplier is shared, and a retry of
 * the same trip cannot double any of it.
 */
describe('a delivery of several items', () => {
  const many = (items, over) => recordIntakeLines(env, SHOP, {
    vendor: 'Smith', hold: 'Whiterun', items, ...over,
  }, R);

  it('records every line and stocks every item', async () => {
    await many([
      { item: 'Iron Sword', numItems: 2, pricePer: 5, salePrice: 30 },
      { item: 'Steel Axe', numItems: 3, pricePer: 10, salePrice: 50 },
      { item: 'Nirnroot', numItems: 4, pricePer: 2, ingredient: true },
    ]);
    expect(await itemRow('Iron Sword')).toMatchObject({ stock: 2, price: 30 });
    expect(await itemRow('Steel Axe')).toMatchObject({ stock: 3, price: 50 });
    expect(await itemRow('Nirnroot')).toMatchObject({ stock: 4, ingredient: true });
    expect(await listIntake(env, SHOP, R)).toHaveLength(3);
  });

  it('debits the coffer once per line, so removing one refunds only that line', async () => {
    await many([
      { item: 'Iron Sword', numItems: 2, pricePer: 5 },   // 10
      { item: 'Steel Axe', numItems: 3, pricePer: 10 },   // 30
    ]);
    expect(await cofferBalance(env, SHOP, R)).toBe(-40);
    const axe = (await listIntake(env, SHOP, R)).find((r) => r.item === 'Steel Axe');
    await deleteIntake(env, SHOP, axe.id, R);
    expect(await cofferBalance(env, SHOP, R)).toBe(-10);
  });

  it('shares the supplier across every line — one trip, one vendor', async () => {
    await many([
      { item: 'Iron Sword', numItems: 1, pricePer: 5 },
      { item: 'Steel Axe', numItems: 1, pricePer: 5 },
    ]);
    const rows = await listIntake(env, SHOP, R);
    expect(rows.every((r) => r.vendor === 'Smith' && r.hold === 'Whiterun')).toBe(true);
  });

  it('WRITES NOTHING when any line is bad', async () => {
    // The whole point of validating up front: a typo on line three must not
    // leave lines one and two recorded, with no record saying so.
    await expect(many([
      { item: 'Iron Sword', numItems: 2, pricePer: 5 },
      { item: 'Steel Axe', numItems: 3, pricePer: 10 },
      { item: 'Nirnroot', numItems: 0, pricePer: 2 },
    ])).rejects.toThrow(/whole number/i);
    expect(await listIntake(env, SHOP, R)).toEqual([]);
    expect(await listInventory(env, SHOP, R)).toEqual([]);
    expect(await cofferBalance(env, SHOP, R)).toBe(0);
  });

  it('says WHICH line is bad, since a long list is worth searching', async () => {
    await expect(many([
      { item: 'Iron Sword', numItems: 2, pricePer: 5 },
      { item: '', numItems: 1, pricePer: 5 },
    ])).rejects.toThrow(/item 2/);
  });

  it('refuses an empty delivery', async () => {
    await expect(many([])).rejects.toThrow(/at least one item/i);
  });

  it('folds two lines for the same item onto ONE listing, whatever the casing', async () => {
    // Neither line is in the inventory table yet for the other to find, so the
    // delivery has to remember what it has already claimed.
    await many([
      { item: 'Iron Sword', numItems: 2, pricePer: 5 },
      { item: 'iron sword', numItems: 3, pricePer: 5 },
    ]);
    const inv = await listInventory(env, SHOP, R);
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ item: 'Iron Sword', stock: 5 });
  });

  it('does not record the same trip twice', async () => {
    const trip = [
      { item: 'Iron Sword', numItems: 2, pricePer: 5 },
      { item: 'Steel Axe', numItems: 3, pricePer: 10 },
    ];
    await many(trip, { idempotencyKey: 'trip-1' });
    await many(trip, { idempotencyKey: 'trip-1' });
    expect(await listIntake(env, SHOP, R)).toHaveLength(2);
    expect(await itemRow('Iron Sword')).toMatchObject({ stock: 2 });
  });

  it('still honours a key written before deliveries could have several items', async () => {
    // A retry spanning the deploy: the original row stored the key unsuffixed.
    await recordIntake(env, SHOP, { item: 'Iron Sword', numItems: 2, pricePer: 5, idempotencyKey: 'k' }, R);
    await env.DB.prepare("UPDATE intake SET idem = 'k' WHERE idem = 'k#0'").run();
    await recordIntake(env, SHOP, { item: 'Iron Sword', numItems: 2, pricePer: 5, idempotencyKey: 'k' }, R);
    expect(await itemRow('Iron Sword')).toMatchObject({ stock: 2 });
  });

  it('checks the supplier once for the whole delivery, not per line', async () => {
    await expect(many(
      [{ item: 'Iron Sword', numItems: 1, pricePer: 5 }],
      { fromBusiness: 'Nobody At All' },
    )).rejects.toThrow(/no registered company/i);
  });
});

describe('which trip a line arrived on', () => {
  it('gives every line of one delivery the same key', async () => {
    await recordIntakeLines(env, SHOP, {
      vendor: 'Smith', idempotencyKey: 'trip-a',
      items: [
        { item: 'Iron Sword', numItems: 1, pricePer: 5 },
        { item: 'Steel Axe', numItems: 1, pricePer: 5 },
      ],
    }, R);
    const rows = await listIntake(env, SHOP, R);
    expect(new Set(rows.map((r) => r.delivery)).size).toBe(1);
  });

  it('keeps two separate trips apart, even from the same vendor', async () => {
    await recordIntakeLines(env, SHOP, {
      vendor: 'Smith', idempotencyKey: 'trip-a', items: [{ item: 'Iron Sword', numItems: 1, pricePer: 5 }],
    }, R);
    await recordIntakeLines(env, SHOP, {
      vendor: 'Smith', idempotencyKey: 'trip-b', items: [{ item: 'Steel Axe', numItems: 1, pricePer: 5 }],
    }, R);
    expect(new Set((await listIntake(env, SHOP, R)).map((r) => r.delivery)).size).toBe(2);
  });

  it('leaves a keyless row standing alone rather than folding it into another', async () => {
    // Deliveries recorded before the form could hold several items have no key,
    // and two on the same day were never one trip.
    await recordIntake(env, SHOP, { item: 'Iron Sword', numItems: 1, pricePer: 5 }, R);
    await recordIntake(env, SHOP, { item: 'Steel Axe', numItems: 1, pricePer: 5 }, R);
    const rows = await listIntake(env, SHOP, R);
    expect(new Set(rows.map((r) => r.delivery)).size).toBe(2);
    expect(rows.every((r) => r.delivery.startsWith('row:'))).toBe(true);
  });
});
