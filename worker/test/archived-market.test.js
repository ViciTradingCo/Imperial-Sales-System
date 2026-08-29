/**
 * AN ARCHIVED SHOP'S TRADE LEAVES THE MARKET WITH IT.
 *
 * Archiving used to keep a departed shop's sales in every figure — its prices
 * went on settling what items are worth, its region went on looking busy, and
 * its line stayed in Company Performance marked "(archived)". Those figures
 * describe the network AS IT STANDS, and a shop nobody can buy from is not part
 * of it.
 *
 * What these tests pin down is the pair of claims that make that safe to do:
 * the trade really does leave EVERY figure, and NOTHING IS DESTROYED — restoring
 * the shop puts every number back exactly as it was, because the exclusion is a
 * live subquery and not a flag written onto the rows.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { registerUser, findBusinessByName, archiveCompany, restoreCompany } from '../src/registry.js';
import { marketAnalysis, itemReport, holdReport } from '../src/market.js';
import { courtStock } from '../src/court.js';
import { importItemIndex } from '../src/item-index.js';
import { encodeSaleItems } from '../src/sales.js';
import { upsertItem } from '../src/inventory.js';

let env;
const R = DEFAULT_REALM_ID;
const REGION = 'Whiterun';

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run();
  await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 30 }], R);
});

let n = 0;
async function aShop(name, realm = R) {
  await registerUser(env, { email: 'o' + (++n) + '@x.com', character: 'C' + n, businessName: name,
    asOwner: true, realmId: realm });
  const c = await findBusinessByName(env, name, realm);
  await env.DB.prepare('UPDATE companies SET hold = ? WHERE id = ? AND realm_id = ?')
    .bind(REGION, c.ledgerId, realm).run();
  return c.ledgerId;
}
const sale = (shop, lines, region = REGION, realm = R) => env.DB.prepare(
  `INSERT INTO sales (realm_id, business, ts, order_no, hold, items, qty_total, total, status)
   VALUES (?, ?, '2026-01-01T00:00:00Z', ?, ?, ?, ?, ?, 'OK')`)
  .bind(realm, shop, 'S-' + (++n), region, encodeSaleItems(lines),
    lines.reduce((a, l) => a + l.qty, 0), lines.reduce((a, l) => a + l.qty * l.price, 0)).run();
/** A delivery INTO `shop`, sourced from the region, optionally from a registered seller. */
const intake = (shop, price, qty, from = '', realm = R) => env.DB.prepare(
  `INSERT INTO intake (realm_id, business, ts, item, vendor, source_hold, num_items, price_per, from_business)
   VALUES (?, ?, '2026-01-01T00:00:00Z', 'Iron Sword', 'Smith', ?, ?, ?, ?)`)
  .bind(realm, shop, REGION, qty, price, from).run();

const perf = (d, name) => (d.businesses || []).find((b) => b.business === name);
const value = (d) => (d.items.find((i) => i.item === 'Iron Sword') || {}).avgValue;

describe('an archived shop leaves the market figures', () => {
  it('drops its line from Company Performance, and takes back its own name', async () => {
    await aShop('Alpha');
    const gone = await aShop('Beta');
    await sale('Alpha', [{ name: 'Iron Sword', qty: 1, price: 30 }]);
    await sale('Beta', [{ name: 'Iron Sword', qty: 1, price: 30 }]);

    expect(perf(await marketAnalysis(env, R), 'Beta').revenue).toBe(30);
    await archiveCompany(env, gone, R);

    const after = await marketAnalysis(env, R);
    expect(perf(after, 'Alpha').revenue).toBe(30);
    expect(perf(after, 'Beta')).toBe(undefined);
    // Not under the archived key either — the row is gone from the table, not
    // renamed within it, which was the old behaviour.
    expect(after.businesses.some((b) => /archived/i.test(b.business))).toBe(false);
  });

  /**
   * The figure this matters most for. A shop that sold ten swords at 300 while
   * everyone else sold at 30 was still voting on what a sword is worth long
   * after it stopped trading.
   */
  it('stops its prices settling what an item is worth', async () => {
    await aShop('Alpha');
    const gone = await aShop('Beta');
    await sale('Alpha', [{ name: 'Iron Sword', qty: 1, price: 30 }]);
    await sale('Beta', [{ name: 'Iron Sword', qty: 10, price: 300 }]);

    expect(value(await marketAnalysis(env, R))).toBe(300); // the departed shop outweighs
    await archiveCompany(env, gone, R);
    expect(value(await marketAnalysis(env, R))).toBe(30);
    // …and the single-item report reads from the same evidence.
    expect((await itemReport(env, 'Iron Sword', R)).item.avgValue).toBe(30);
  });

  it('takes its deliveries and its transfers out of the valuation too', async () => {
    await aShop('Alpha');
    const gone = await aShop('Beta');
    await sale('Alpha', [{ name: 'Iron Sword', qty: 1, price: 30 }]);
    await intake('Beta', 900, 10);
    await env.DB.prepare(
      `INSERT INTO transfers (realm_id, from_business, to_business, item, qty, price, status, ts)
       VALUES (?, 'Beta', 'Alpha', 'Iron Sword', 10, 900, 'accepted', '2026-01-01T00:00:00Z')`).bind(R).run();

    expect(value(await marketAnalysis(env, R))).toBe(900);
    await archiveCompany(env, gone, R);
    expect(value(await marketAnalysis(env, R))).toBe(30);
  });

  it('stops crediting its region with commerce that has stopped happening', async () => {
    await aShop('Alpha');
    const gone = await aShop('Beta');
    await sale('Alpha', [{ name: 'Iron Sword', qty: 1, price: 30 }]);
    await sale('Beta', [{ name: 'Iron Sword', qty: 1, price: 70 }]);

    const region = (d) => d.holds.find((h) => h.hold === REGION);
    expect(region(await marketAnalysis(env, R)).revenue).toBe(100);
    await archiveCompany(env, gone, R);
    expect(region(await marketAnalysis(env, R)).revenue).toBe(30);
  });

  it('is left out of the pricing anomalies — it is charging nobody anything', async () => {
    await aShop('Alpha');
    const gone = await aShop('Beta');
    await sale('Alpha', [{ name: 'Iron Sword', qty: 1, price: 30 }]);
    await upsertItem(env, 'Beta', { item: 'Iron Sword', price: 300 }, R);

    expect((await marketAnalysis(env, R)).overpriced.map((o) => o.business)).toContain('Beta');
    await archiveCompany(env, gone, R);
    expect((await marketAnalysis(env, R)).overpriced).toEqual([]);
  });

  /**
   * THE OTHER HALF OF THE PROMISE. Archiving is not deleting, so every figure
   * has to come back — not approximately, exactly. Nothing is rewritten on the
   * way out, so there is nothing to get wrong on the way back.
   */
  it('gives every figure back, unchanged, when the shop is restored', async () => {
    await aShop('Alpha');
    const gone = await aShop('Beta');
    await sale('Alpha', [{ name: 'Iron Sword', qty: 1, price: 30 }]);
    await sale('Beta', [{ name: 'Iron Sword', qty: 10, price: 300 }]);
    await intake('Beta', 40, 5);

    const before = await marketAnalysis(env, R);
    await archiveCompany(env, gone, R);
    await restoreCompany(env, gone, R);
    expect(await marketAnalysis(env, R)).toEqual(before);
  });

  it('leaves other realms alone', async () => {
    await env.DB.prepare("INSERT INTO realms (id, name) VALUES ('other', 'Other')").run();
    await aShop('Alpha');
    const gone = await aShop('Beta');
    await sale('Beta', [{ name: 'Iron Sword', qty: 1, price: 30 }]);
    // A DIFFERENT realm with a shop of the same name, trading normally.
    await importItemIndex(env, [{ name: 'Iron Sword', baseValue: 30 }], 'other');
    await aShop('Beta', 'other');
    await sale('Beta', [{ name: 'Iron Sword', qty: 1, price: 55 }], REGION, 'other');

    await archiveCompany(env, gone, R);
    expect(perf(await marketAnalysis(env, R), 'Beta')).toBe(undefined);
    expect(perf(await marketAnalysis(env, 'other'), 'Beta').revenue).toBe(55);
  });
});

describe("what a Court sees of a shop that has left its region", () => {
  it('drops it from the region overview and from the sellers table', async () => {
    await aShop('Alpha');
    const gone = await aShop('Beta');
    await sale('Alpha', [{ name: 'Iron Sword', qty: 1, price: 30 }]);
    await sale('Beta', [{ name: 'Iron Sword', qty: 1, price: 70 }]);

    expect((await holdReport(env, REGION, R)).overview.revenue).toBe(100);
    await archiveCompany(env, gone, R);
    const after = await holdReport(env, REGION, R);
    expect(after.overview.revenue).toBe(30);
    expect(after.businesses.map((b) => b.business)).toEqual(['Alpha']);
  });

  /**
   * A live shop's purchase FROM a shop that has since closed. The buyer is
   * still here and really did pay for it, so the region keeps the trade — but
   * there is no longer a registered company to credit, which is exactly what
   * the unregistered bucket is for. The table has to go on adding up.
   */
  it('moves a departed supplier’s supply into the uncredited bucket rather than losing it', async () => {
    await aShop('Alpha');
    const gone = await aShop('Beta');
    await intake('Alpha', 10, 4, 'Beta'); // Alpha bought 4 @ 10 from Beta

    const before = await holdReport(env, REGION, R);
    expect(before.overview.revenue).toBe(40);
    expect(before.businesses.map((b) => b.business)).toEqual(['Beta']);
    expect(before.unregistered.revenue).toBe(0);

    await archiveCompany(env, gone, R);
    const after = await holdReport(env, REGION, R);
    expect(after.overview.revenue).toBe(40);       // the region's trade is unchanged
    expect(after.businesses).toEqual([]);          // nobody left to credit
    expect(after.unregistered.revenue).toBe(40);   // …so it is named as uncredited
  });

  it('stops counting its shelves as stock the region can buy', async () => {
    await aShop('Alpha');
    const gone = await aShop('Beta');
    await upsertItem(env, 'Alpha', { item: 'Iron Sword', price: 25 }, R);
    await upsertItem(env, 'Beta', { item: 'Iron Sword', price: 25 }, R);
    await env.DB.prepare('UPDATE inventory SET stock = 10').run();

    expect((await courtStock(env, REGION, R))[0]).toMatchObject({ forSale: 20, shops: 2 });
    await archiveCompany(env, gone, R);
    expect((await courtStock(env, REGION, R))[0]).toMatchObject({ forSale: 10, shops: 1 });
  });
});
