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
import { listInventory, upsertItem } from '../src/inventory.js';
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

/**
 * PAID HARVEST — the shop buying goods off its own people at a rate the owner
 * set in advance.
 *
 * Unlike wages, which this system only ever records as OWED, this settles when
 * the goods are handed over: it is a purchase, priced beforehand, and the
 * coffer pays for it the same way it pays any other supplier.
 */
describe('a harvest the shop pays for', () => {
  const setRate = (item, rate) => upsertItem(env, SHOP, { item, price: 10, harvestPay: rate }, R);

  it('pays the rate the OWNER set, not one the request asks for', async () => {
    await setRate('Nirnroot', 3);
    // A generous self-assessment, ignored: the rate comes off the item.
    const res = await recordHarvest(env, SHOP, { item: 'Nirnroot', numItems: 10, claimPay: true, rate: 999, harvestPay: 999 }, R);
    expect(res.rate).toBe(3);
    expect(res.paid).toBe(30);
    expect(await cofferBalance(env, SHOP, R)).toBe(-30);
  });

  it('adds the stock as well as paying for it', async () => {
    await setRate('Nirnroot', 3);
    await recordHarvest(env, SHOP, { item: 'Nirnroot', numItems: 10, claimPay: true }, R);
    expect(await itemRow('Nirnroot')).toMatchObject({ stock: 10 });
  });

  it('records the expense against the coffer with who and what', async () => {
    await setRate('Nirnroot', 3);
    await recordHarvest(env, SHOP, { item: 'Nirnroot', numItems: 4, claimPay: true, employee: 'Ann' }, R);
    const { results } = await env.DB.prepare('SELECT kind, amount, note FROM coffer_entries').all();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: 'harvest-pay', amount: -12 });
    expect(results[0].note).toContain('Nirnroot');
    expect(results[0].note).toContain('Ann');
  });

  it('rounds the payment down to whole coins, once, on the total', async () => {
    // 7 at 2.5 is 17.5 — 17, not 7 lots of 2 and not 18.
    await setRate('Nirnroot', 2.5);
    const res = await recordHarvest(env, SHOP, { item: 'Nirnroot', numItems: 7, claimPay: true }, R);
    expect(res.paid).toBe(17);
    expect(await cofferBalance(env, SHOP, R)).toBe(-17);
  });

  it('refuses to pay for an item with no rate set', async () => {
    await upsertItem(env, SHOP, { item: 'Wheat', price: 4 }, R);
    await expect(recordHarvest(env, SHOP, { item: 'Wheat', numItems: 5, claimPay: true }, R))
      .rejects.toThrow(/no harvest rate/i);
    // And nothing landed: no stock, no coffer line.
    expect(await itemRow('Wheat')).toMatchObject({ stock: 0 });
    expect(await cofferBalance(env, SHOP, R)).toBe(0);
  });

  it('refuses to pay for something the shop has never listed', async () => {
    await expect(recordHarvest(env, SHOP, { item: 'Moon Sugar', numItems: 5, claimPay: true }, R))
      .rejects.toThrow(/no harvest rate/i);
  });

  it('leaves an UNPAID harvest exactly as it was — free, and no coffer line', async () => {
    await setRate('Nirnroot', 3);
    const res = await recordHarvest(env, SHOP, { item: 'Nirnroot', numItems: 10 }, R);
    expect(res.paid).toBe(0);
    expect(await cofferBalance(env, SHOP, R)).toBe(0);
    // Still excluded from what the shop pays for its stock, since it paid
    // nothing for this one.
    expect((await listInventory(env, SHOP, R))[0].avgCost).toBe(null);
  });

  it('counts a PAID harvest toward what the stock cost the shop', async () => {
    // It really did cost that, so the average an owner restocks against has to
    // include it — this is the one difference a rate makes to the figures.
    await setRate('Nirnroot', 3);
    await recordHarvest(env, SHOP, { item: 'Nirnroot', numItems: 10, claimPay: true }, R);
    expect((await listInventory(env, SHOP, R))[0].avgCost).toBe(3);
  });

  it('does not pay twice for the same haul', async () => {
    await setRate('Nirnroot', 3);
    await recordHarvest(env, SHOP, { item: 'Nirnroot', numItems: 10, claimPay: true, idempotencyKey: 'h1' }, R);
    const again = await recordHarvest(env, SHOP, { item: 'Nirnroot', numItems: 10, claimPay: true, idempotencyKey: 'h1' }, R);
    expect(again.duplicate).toBe(true);
    expect(again.paid).toBe(0);
    expect(await cofferBalance(env, SHOP, R)).toBe(-30);
    expect(await itemRow('Nirnroot')).toMatchObject({ stock: 10 });
  });
});

describe('the harvest rate on an item', () => {
  it('is kept by an edit that does not mention it', async () => {
    // Same rule the sale price follows on a restock: blank is "leave it", not 0.
    await upsertItem(env, SHOP, { item: 'Nirnroot', price: 10, harvestPay: 3 }, R);
    await upsertItem(env, SHOP, { item: 'Nirnroot', price: 12 }, R);
    expect((await listInventory(env, SHOP, R))[0]).toMatchObject({ price: 12, harvestPay: 3 });
  });

  it('can be cleared back to nothing on purpose', async () => {
    await upsertItem(env, SHOP, { item: 'Nirnroot', price: 10, harvestPay: 3 }, R);
    await upsertItem(env, SHOP, { item: 'Nirnroot', price: 10, harvestPay: 0 }, R);
    expect((await listInventory(env, SHOP, R))[0].harvestPay).toBe(0);
    await expect(recordHarvest(env, SHOP, { item: 'Nirnroot', numItems: 1, claimPay: true }, R))
      .rejects.toThrow(/no harvest rate/i);
  });

  it('refuses a negative rate', async () => {
    await expect(upsertItem(env, SHOP, { item: 'Nirnroot', price: 10, harvestPay: -1 }, R))
      .rejects.toThrow(/≥ 0/);
  });
});

/**
 * A HAUL OF SEVERAL THINGS. You come back from a morning's work with wheat AND
 * apples AND a hare; recording that as three trips means three lines in the
 * delivery log for one walk back from the field, and three chances for the
 * connection to drop between them.
 *
 * The rules that have to hold are the ones a list makes newly breakable:
 * nothing lands if any line is bad, the log knows it was ONE trip, and a haul
 * that mixes a paid crop with an unpaid one pays for the half it should.
 */
describe('a harvest of several items at once', () => {
  const setRate = (item, rate) => upsertItem(env, SHOP, { item, price: 10, harvestPay: rate }, R);
  const HAUL = [
    { item: 'Wheat', numItems: 20 },
    { item: 'Apple', numItems: 6 },
    { item: 'Hare', numItems: 2 },
  ];

  it('adds every line in one go', async () => {
    await recordHarvest(env, SHOP, { items: HAUL }, R);
    const inv = await listInventory(env, SHOP, R);
    expect(inv.map((i) => [i.item, i.stock]).sort()).toEqual([['Apple', 6], ['Hare', 2], ['Wheat', 20]]);
  });

  it('records it as ONE trip in the delivery log', async () => {
    await recordHarvest(env, SHOP, { items: HAUL, idempotencyKey: 'h9' }, R);
    const log = await listIntake(env, SHOP, R);
    expect(log).toHaveLength(3);
    // Every line of one haul shares a delivery, which is what groups them.
    expect(new Set(log.map((l) => l.delivery)).size).toBe(1);
    expect(log.every((l) => l.vendor === HARVEST_VENDOR)).toBe(true);
  });

  it('lands nothing at all when one line is bad', async () => {
    await expect(recordHarvest(env, SHOP, {
      items: [...HAUL, { item: 'Rabbit', numItems: 0 }],
    }, R)).rejects.toThrow(/item 4/i);
    expect(await listInventory(env, SHOP, R)).toEqual([]);
    expect(await listIntake(env, SHOP, R)).toEqual([]);
  });

  it('names the line with no item on it', async () => {
    await expect(recordHarvest(env, SHOP, {
      items: [{ item: 'Wheat', numItems: 1 }, { item: '  ', numItems: 3 }],
    }, R)).rejects.toThrow(/which item did you bring in\? \(item 2\)/i);
  });

  // The shelf is read in one query now, so nothing is in the table yet for a
  // second line of a NEW crop to find. The first spelling in the haul has to
  // win, or "Wheat" and "wheat" become two listings with the morning split
  // between them.
  it('folds two lines of the same crop onto one listing, however cased', async () => {
    await recordHarvest(env, SHOP, { items: [{ item: 'Wheat', numItems: 5 }, { item: 'wheat', numItems: 7 }] }, R);
    const inv = await listInventory(env, SHOP, R);
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ item: 'Wheat', stock: 12 });
  });

  it('takes the Ingredient flag per line, not per haul', async () => {
    await recordHarvest(env, SHOP, {
      items: [{ item: 'Wheat', numItems: 5, ingredient: true }, { item: 'Apple', numItems: 5 }],
    }, R);
    const inv = await listInventory(env, SHOP, R);
    expect(inv.find((i) => i.item === 'Wheat').ingredient).toBe(true);
    expect(inv.find((i) => i.item === 'Apple').ingredient).toBe(false);
  });

  it('is idempotent for the whole haul', async () => {
    await recordHarvest(env, SHOP, { items: HAUL, idempotencyKey: 'h1' }, R);
    const again = await recordHarvest(env, SHOP, { items: HAUL, idempotencyKey: 'h1' }, R);
    expect(again.duplicate).toBe(true);
    expect((await listInventory(env, SHOP, R)).find((i) => i.item === 'Wheat').stock).toBe(20);
    expect(await listIntake(env, SHOP, R)).toHaveLength(3);
  });

  // A haul of one recorded its key unsuffixed until this became multi-line. A
  // retry that spans the deploy must still not double the crop.
  it('still recognises a retry of a haul recorded before this', async () => {
    await recordHarvest(env, SHOP, { item: 'Wheat', numItems: 5, idempotencyKey: 'old' }, R);
    await env.DB.prepare("UPDATE intake SET idem = 'old' WHERE idem = 'old#0'").run();
    const again = await recordHarvest(env, SHOP, { items: [{ item: 'Wheat', numItems: 5 }], idempotencyKey: 'old' }, R);
    expect(again.duplicate).toBe(true);
    expect((await listInventory(env, SHOP, R))[0].stock).toBe(5);
  });

  describe('when the shop pays for some of it', () => {
    it('pays each line its own rate, and nothing for the ones with none', async () => {
      await setRate('Nirnroot', 3);
      await setRate('Wheat', 1);
      const res = await recordHarvest(env, SHOP, {
        claimPay: true,
        items: [{ item: 'Nirnroot', numItems: 10 }, { item: 'Wheat', numItems: 4 }, { item: 'Hare', numItems: 2 }],
      }, R);
      expect(res.paid).toBe(34); // 30 + 4 + nothing for the hare
      // Each line says what and at what rate; the MONEY is the one settled
      // figure above, so there is no second set of numbers to disagree with it.
      expect(res.lines).toEqual([
        { item: 'Nirnroot', qty: 10, rate: 3 },
        { item: 'Wheat', qty: 4, rate: 1 },
        { item: 'Hare', qty: 2, rate: 0 },
      ]);
      expect(await cofferBalance(env, SHOP, R)).toBe(-34);
    });

    // One entry per paid line, for the reason a delivery does the same: each
    // line is its own intake row, and deleting one refunds exactly what it took.
    it('writes ONE coffer entry for the haul, whatever it took to bring in', async () => {
      await setRate('Nirnroot', 3);
      const res = await recordHarvest(env, SHOP, {
        claimPay: true, employee: 'Ann',
        items: [{ item: 'Nirnroot', numItems: 2 }, { item: 'Hare', numItems: 9 }],
      }, R);
      const { results } = await env.DB.prepare('SELECT kind, amount, note FROM coffer_entries').all();
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ kind: 'harvest-pay', amount: -6 });
      expect(results[0].note).toContain('Nirnroot');
      expect(res.paid).toBe(6);
    });

    // A claim against nothing is still refused — but only when NOTHING pays.
    it('refuses a claim when no line in the haul has a rate', async () => {
      await expect(recordHarvest(env, SHOP, {
        claimPay: true, items: [{ item: 'Wheat', numItems: 5 }, { item: 'Hare', numItems: 1 }],
      }, R)).rejects.toThrow(/harvest rate/i);
      expect(await listInventory(env, SHOP, R)).toEqual([]);
    });

    it('never lets the request name a rate', async () => {
      await setRate('Nirnroot', 3);
      const res = await recordHarvest(env, SHOP, {
        claimPay: true,
        items: [{ item: 'Nirnroot', numItems: 10, rate: 999, harvestPay: 999, paid: 999 }],
      }, R);
      expect(res.paid).toBe(30);
    });

    it('pays nothing at all when the claim is not made', async () => {
      await setRate('Nirnroot', 3);
      const res = await recordHarvest(env, SHOP, { items: [{ item: 'Nirnroot', numItems: 10 }] }, R);
      expect(res.paid).toBe(0);
      expect(await cofferBalance(env, SHOP, R)).toBe(0);
    });
  });
});

/**
 * ONE LEDGER LINE PER BULK ACT, and the arithmetic that has to hold around it.
 *
 * A delivery is a single act — coin left the coffer once — so the coffer gets
 * one entry for the trip rather than one per item. That is also the only way to
 * obey the money rule: rounding every line compounds the loss, and three lines
 * at 10.5 must take 31 rather than three tens.
 *
 * Which moves the weight onto DELETION. If the debit is settled once, a line's
 * refund is not its own price rounded down — it is the difference that line
 * makes to the trip. The test that matters is the round trip: record it, remove
 * every line, and the coffer must be exactly where it started.
 */
describe('what a bulk act writes to the coffer', () => {
  const lines = (items, key) => recordIntakeLines(env, SHOP, {
    items, vendor: 'Smith', hold: 'Whiterun', idempotencyKey: key,
  }, R);
  const cofferRows = async () => ((await env.DB.prepare(
    'SELECT kind, amount, note, ref FROM coffer_entries ORDER BY id').all()).results) || [];

  it('takes ONE debit for a delivery, not one per item', async () => {
    await lines([
      { item: 'Iron Sword', numItems: 2, pricePer: 5 },
      { item: 'Ale', numItems: 4, pricePer: 2 },
      { item: 'Rope', numItems: 1, pricePer: 3 },
    ], 'd1');
    const rows = await cofferRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'intake', amount: -21, ref: 'd1' });
    expect(rows[0].note).toBe('Iron Sword ×2 + 2 more');
    expect(await cofferBalance(env, SHOP, R)).toBe(-21);
  });

  it('settles the total once, so pennies do not compound down the list', async () => {
    // Three lines at 10.5. Rounded per line that is 30; the trip cost 31.
    await lines([
      { item: 'A', numItems: 1, pricePer: 10.5 },
      { item: 'B', numItems: 1, pricePer: 10.5 },
      { item: 'C', numItems: 1, pricePer: 10.5 },
    ], 'd2');
    expect(await cofferBalance(env, SHOP, R)).toBe(-31);
  });

  it('names the delivery the same way everything else names a bulk thing', async () => {
    await lines([{ item: 'Ale', numItems: 4, pricePer: 2 }], 'd3');
    expect((await cofferRows())[0].note).toBe('Ale ×4');
  });

  it('writes nothing at all for a delivery that cost nothing', async () => {
    await lines([{ item: 'Gift', numItems: 3, pricePer: 0 }], 'd4');
    expect(await cofferRows()).toEqual([]);
    expect(await cofferBalance(env, SHOP, R)).toBe(0);
  });

  describe('and what removing a line gives back', () => {
    it('returns the coffer to exactly where it started, line by line', async () => {
      await lines([
        { item: 'A', numItems: 1, pricePer: 10.5 },
        { item: 'B', numItems: 1, pricePer: 10.5 },
        { item: 'C', numItems: 1, pricePer: 10.5 },
      ], 'd5');
      expect(await cofferBalance(env, SHOP, R)).toBe(-31);
      // Removed one at a time, in the order they appear.
      for (const entry of await listIntake(env, SHOP, R)) {
        await deleteIntake(env, SHOP, entry.id, R);
      }
      // Not -1, not +2. The refunds add back up to the debit.
      expect(await cofferBalance(env, SHOP, R)).toBe(0);
    });

    it('gives back what the line is worth to the trip, not its rounded own price', async () => {
      await lines([
        { item: 'A', numItems: 1, pricePer: 10.5 },
        { item: 'B', numItems: 1, pricePer: 10.5 },
      ], 'd6');
      expect(await cofferBalance(env, SHOP, R)).toBe(-21);
      const [first] = await listIntake(env, SHOP, R);
      const res = await deleteIntake(env, SHOP, first.id, R);
      // 21 out, 10 left owing on the line that stays → 11 back, not 10.
      expect(res.refunded).toBe(11);
      expect(await cofferBalance(env, SHOP, R)).toBe(-10);
    });

    it('reconciles a paid haul the same way', async () => {
      await upsertItem(env, SHOP, { item: 'Nirnroot', price: 10, harvestPay: 2.5 }, R);
      await upsertItem(env, SHOP, { item: 'Wheat', price: 4, harvestPay: 2.5 }, R);
      await recordHarvest(env, SHOP, {
        claimPay: true, idempotencyKey: 'h5',
        items: [{ item: 'Nirnroot', numItems: 1 }, { item: 'Wheat', numItems: 1 }],
      }, R);
      expect(await cofferBalance(env, SHOP, R)).toBe(-5); // one entry, settled once
      expect((await cofferRows()).filter((r) => r.kind === 'harvest-pay')).toHaveLength(1);
      for (const entry of await listIntake(env, SHOP, R)) {
        await deleteIntake(env, SHOP, entry.id, R);
      }
      expect(await cofferBalance(env, SHOP, R)).toBe(0);
    });

    /**
     * A delivery recorded BEFORE this took one debit per line. Its coffer lines
     * carry no `ref`, so a deletion falls back to the old rule and refunds
     * exactly what that line took — which is what stops an old delivery minting
     * a coin on its way out.
     */
    it('refunds a delivery from before by the rule it was written under', async () => {
      await lines([
        { item: 'A', numItems: 1, pricePer: 10.5 },
        { item: 'B', numItems: 1, pricePer: 10.5 },
      ], 'old');
      // Rewrite history into the old shape: two debits of 10, no ref.
      await env.DB.prepare('DELETE FROM coffer_entries').run();
      for (const item of ['A', 'B']) {
        await env.DB.prepare(
          `INSERT INTO coffer_entries (realm_id, business, ts, kind, amount, note)
           VALUES (?, ?, ?, 'intake', -10, ?)`).bind(R, SHOP, new Date().toISOString(), item).run();
      }
      expect(await cofferBalance(env, SHOP, R)).toBe(-20);
      for (const entry of await listIntake(env, SHOP, R)) {
        await deleteIntake(env, SHOP, entry.id, R);
      }
      expect(await cofferBalance(env, SHOP, R)).toBe(0);
    });
  });
});
