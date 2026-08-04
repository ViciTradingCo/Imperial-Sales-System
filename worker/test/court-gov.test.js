/**
 * The Court as a government: the levy, licences and sanctions, price controls,
 * the treasury.
 *
 * The load-bearing rule is that THE MONEY NEVER MOVES ON ITS OWN. A levy is a
 * debt recorded against a shop, and it becomes money only when the Court says
 * it was paid.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { ensureDefaultRealm } from '../src/realm.js';
import { registerUser, updateCompany, listCompanies } from '../src/registry.js';
import {
  readCourtSettings, writeCourtSettings, courtStandings, setCourtStanding, standingOf,
  courtPrices, setCourtPrice, courtRules, accrueLevy, courtDues, recordDuesPayment,
  recordCourtSpend, courtStock, SPEND_CATEGORIES,
} from '../src/court.js';
import { cofferBalance } from '../src/coffers.js';
import { cacheBust } from '../src/cache.js';

let env;
const R = DEFAULT_REALM_ID;
const HOLD = 'Whiterun';
const SEAT = 'Whiterun Court';
const SHOP = 'Iron Hearth';
const AWAY = 'Rift Traders';

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of [...REALM_TABLES, 'realms']) await env.DB.prepare('DELETE FROM ' + t).run();
  cacheBust('');
  await ensureDefaultRealm(env);
  await registerUser(env, { email: 'c@x.test', character: 'Jarl', businessName: SEAT, asOwner: true, hold: HOLD, realmId: R });
  await registerUser(env, { email: 's@x.test', character: 'Smith', businessName: SHOP, asOwner: true, hold: HOLD, realmId: R });
  await registerUser(env, { email: 'r@x.test', character: 'Bersi', businessName: AWAY, asOwner: true, hold: 'The Rift', realmId: R });
  const co = (await listCompanies(env, R)).find((c) => c.business === SEAT);
  await updateCompany(env, { id: co.id, name: SEAT, hold: HOLD, court: true, perpetual: true }, R);
});

describe('the levy', () => {
  it('is off at 0, and writes nothing at all', async () => {
    const s = await readCourtSettings(env, HOLD, R);
    expect(s.taxPercent).toBe(0);
    const rules = await courtRules(env, HOLD, R);
    const levy = await accrueLevy(env, rules, { business: SHOP, total: 500, orderNo: 'A' }, R);
    expect(levy).toBe(0);
    // No row: 0% is the feature disabled, not a rate that happens to be zero.
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM court_dues').first();
    expect(rows.n).toBe(0);
  });

  it('records a debt when set, without moving any money', async () => {
    await writeCourtSettings(env, HOLD, { taxPercent: 10 }, R);
    const rules = await courtRules(env, HOLD, R);
    const levy = await accrueLevy(env, rules, { business: SHOP, total: 250, orderNo: 'A-1' }, R);
    expect(levy).toBe(25);
    const dues = await courtDues(env, HOLD, R);
    expect(dues.total).toBe(25);
    // The Court has been paid nothing — it has only been owed.
    expect(await cofferBalance(env, SEAT, R)).toBe(0);
    expect(await cofferBalance(env, SHOP, R)).toBe(0);
  });

  it('does not tax the Court itself', async () => {
    await writeCourtSettings(env, HOLD, { taxPercent: 10 }, R);
    const rules = await courtRules(env, HOLD, R);
    expect(await accrueLevy(env, rules, { business: SEAT, total: 500 }, R)).toBe(0);
  });

  it('refuses a rate outside 0–100', async () => {
    await expect(writeCourtSettings(env, HOLD, { taxPercent: -1 }, R)).rejects.toThrow(/between 0 and 100/i);
    await expect(writeCourtSettings(env, HOLD, { taxPercent: 101 }, R)).rejects.toThrow(/between 0 and 100/i);
  });

  it('applies no rules in a region with no Court', async () => {
    expect(await courtRules(env, 'The Rift', R)).toBeNull();
  });

  it('becomes money only when a payment is recorded', async () => {
    await writeCourtSettings(env, HOLD, { taxPercent: 10 }, R);
    const rules = await courtRules(env, HOLD, R);
    await accrueLevy(env, rules, { business: SHOP, total: 250 }, R);
    const after = await recordDuesPayment(env, HOLD, { business: SHOP, amount: 25 }, R, SEAT);
    expect(after.total).toBe(0);
    expect(await cofferBalance(env, SEAT, R)).toBe(25);
  });

  it('refuses a payment of nothing', async () => {
    await expect(recordDuesPayment(env, HOLD, { business: SHOP, amount: 0 }, R, SEAT))
      .rejects.toThrow(/greater than zero/i);
  });
});

describe('licences and sanctions', () => {
  it('starts every shop with no ruling — a seal has to be granted', async () => {
    const list = await courtStandings(env, HOLD, R);
    expect(list.every((c) => c.standing === 'none')).toBe(true);
  });

  it('records a ruling and reads it back for the register', async () => {
    await setCourtStanding(env, HOLD, { business: SHOP, standing: 'banned', note: 'smuggling' }, R);
    expect(await standingOf(env, SHOP, HOLD, R)).toBe('banned');
  });

  it('refuses a shop outside the region', async () => {
    await expect(setCourtStanding(env, HOLD, { business: AWAY, standing: 'banned' }, R))
      .rejects.toThrow(/does not trade in your region/i);
  });

  it('will not let a Court bar itself', async () => {
    await expect(setCourtStanding(env, HOLD, { business: SEAT, standing: 'banned' }, R))
      .rejects.toThrow(/cannot bar itself/i);
  });

  it('refuses a standing it does not recognise', async () => {
    await expect(setCourtStanding(env, HOLD, { business: SHOP, standing: 'outlawed' }, R))
      .rejects.toThrow(/unknown standing/i);
  });

  it('does not follow a shop that leaves the region', async () => {
    await setCourtStanding(env, HOLD, { business: SHOP, standing: 'banned' }, R);
    // A Court's authority is over its region; moving out ends it.
    expect(await standingOf(env, SHOP, 'The Rift', R)).toBe('none');
  });
});

describe('price controls', () => {
  it('stores a floor and a ceiling', async () => {
    await setCourtPrice(env, HOLD, { item: 'Iron Sword', min: 20, max: 60 }, R);
    expect(await courtPrices(env, HOLD, R)).toEqual([{ item: 'Iron Sword', min: 20, max: 60 }]);
  });

  it('accepts one bound alone', async () => {
    await setCourtPrice(env, HOLD, { item: 'Iron Sword', max: 60 }, R);
    expect((await courtPrices(env, HOLD, R))[0]).toEqual({ item: 'Iron Sword', min: null, max: 60 });
  });

  it('lifts the control when both bounds are cleared', async () => {
    await setCourtPrice(env, HOLD, { item: 'Iron Sword', min: 20, max: 60 }, R);
    await setCourtPrice(env, HOLD, { item: 'Iron Sword', min: '', max: '' }, R);
    expect(await courtPrices(env, HOLD, R)).toEqual([]);
  });

  it('refuses a floor above its ceiling', async () => {
    await expect(setCourtPrice(env, HOLD, { item: 'Iron Sword', min: 90, max: 10 }, R))
      .rejects.toThrow(/floor cannot be above/i);
  });

  it('reaches checkout as a lookup keyed the way item names compare', async () => {
    await setCourtPrice(env, HOLD, { item: 'Iron Sword', max: 60 }, R);
    const rules = await courtRules(env, HOLD, R);
    expect(rules.prices.get('iron sword')).toMatchObject({ max: 60 });
  });
});

describe('the treasury', () => {
  it('records spending by category and debits the Court\'s coffer', async () => {
    const d = await recordCourtSpend(env, HOLD, { category: 'Guards & security', amount: 120, note: 'wages' }, R, SEAT);
    expect(d.total).toBe(120);
    expect(d.byCategory).toEqual([{ category: 'Guards & security', amount: 120 }]);
    // The treasury record and the Court's accounts must agree.
    expect(await cofferBalance(env, SEAT, R)).toBe(-120);
  });

  it('pins an unknown category to the catch-all', async () => {
    const d = await recordCourtSpend(env, HOLD, { category: 'Bribes', amount: 10 }, R, SEAT);
    expect(d.entries[0].category).toBe(SPEND_CATEGORIES[SPEND_CATEGORIES.length - 1]);
  });

  it('refuses an amount of nothing', async () => {
    await expect(recordCourtSpend(env, HOLD, { category: 'Other', amount: 0 }, R, SEAT))
      .rejects.toThrow(/greater than zero/i);
  });
});

describe('what the region holds', () => {
  it('counts stock for sale and crafting materials apart', async () => {
    await env.DB.prepare(
      `INSERT INTO inventory (realm_id, business, item, price, stock, low_stock, ingredient)
       VALUES (?, ?, 'Iron Ingot', 5, 40, 0, 1), (?, ?, 'Iron Sword', 30, 6, 0, 0)`)
      .bind(R, SHOP, R, SHOP).run();
    // Another region's stock must not appear.
    await env.DB.prepare(
      `INSERT INTO inventory (realm_id, business, item, price, stock, low_stock, ingredient)
       VALUES (?, ?, 'Iron Sword', 30, 99, 0, 0)`).bind(R, AWAY).run();
    const stock = await courtStock(env, HOLD, R);
    const byItem = new Map(stock.map((s) => [s.item, s]));
    expect(byItem.get('Iron Sword')).toMatchObject({ forSale: 6, materials: 0, shops: 1 });
    expect(byItem.get('Iron Ingot')).toMatchObject({ forSale: 0, materials: 40 });
  });
});

describe('the notice', () => {
  it('is stored and cleared by the same field', async () => {
    await writeCourtSettings(env, HOLD, { notice: 'Market day is Sundas.' }, R);
    expect((await readCourtSettings(env, HOLD, R)).notice).toBe('Market day is Sundas.');
    await writeCourtSettings(env, HOLD, { notice: '  ' }, R);
    expect((await readCourtSettings(env, HOLD, R)).notice).toBe('');
  });

  it('does not disturb the levy when only the notice is set', async () => {
    await writeCourtSettings(env, HOLD, { taxPercent: 7 }, R);
    await writeCourtSettings(env, HOLD, { notice: 'Hello' }, R);
    expect((await readCourtSettings(env, HOLD, R)).taxPercent).toBe(7);
  });
});
