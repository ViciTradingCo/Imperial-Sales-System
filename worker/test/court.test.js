/**
 * Court oversight.
 *
 * A Court sees more of its neighbours than an ordinary shop does — rosters and
 * ledgers — so what bounds it is the whole feature: its own REGION, and its own
 * realm. These tests are that boundary.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { ensureDefaultRealm } from '../src/realm.js';
import { registerUser, updateCompany, listCompanies } from '../src/registry.js';
import { requireCourt, courtCompanies, courtShop, shopRoster, shopOverview } from '../src/oversight.js';
import { holdReport } from '../src/market.js';
import { TRAVELING } from '../src/regions.js';
import { cacheBust } from '../src/cache.js';

let env;
const R = DEFAULT_REALM_ID;
const OTHER = 'rlm-court-b';

const COURT = 'Whiterun Court';
const NEIGHBOUR = 'Iron Hearth';
const OUTSIDER = 'Rift Traders';

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of [...REALM_TABLES, 'realms']) await env.DB.prepare('DELETE FROM ' + t).run();
  cacheBust('');
  await ensureDefaultRealm(env);
  await env.DB.prepare("INSERT INTO realms (id, name, slug, created) VALUES (?, 'Realm B', 'b', '2026-01-01')")
    .bind(OTHER).run();

  await registerUser(env, { email: 'court@x.test', character: 'Jarl', businessName: COURT, asOwner: true, hold: 'Whiterun', realmId: R });
  await registerUser(env, { email: 'smith@x.test', character: 'Adrianne', businessName: NEIGHBOUR, asOwner: true, hold: 'Whiterun', realmId: R });
  await registerUser(env, { email: 'rift@x.test', character: 'Bersi', businessName: OUTSIDER, asOwner: true, hold: 'The Rift', realmId: R });
  // Same shop name, same region, another realm — the worst case for scoping.
  await registerUser(env, { email: 'other@x.test', character: 'Twin', businessName: NEIGHBOUR, asOwner: true, hold: 'Whiterun', realmId: OTHER });

  const co = (await listCompanies(env, R)).find((c) => c.business === COURT);
  await updateCompany(env, { id: co.id, name: COURT, hold: 'Whiterun', court: true, perpetual: true }, R);
});

describe('who is a Court', () => {
  it('resolves the region a Court oversees', async () => {
    expect(await requireCourt(env, COURT, R)).toBe('Whiterun');
  });

  it('refuses a company that is not one', async () => {
    await expect(requireCourt(env, NEIGHBOUR, R)).rejects.toThrow(/court businesses only/i);
    await expect(requireCourt(env, 'No Such Shop', R)).rejects.toThrow(/court businesses only/i);
  });

  it('refuses a Court with no region assigned rather than showing it everything', async () => {
    const co = (await listCompanies(env, R)).find((c) => c.business === COURT);
    await updateCompany(env, { id: co.id, name: COURT, hold: '', court: true }, R);
    await expect(requireCourt(env, COURT, R)).rejects.toThrow(/no region assigned/i);
  });

  // A travelling Court would govern the word "Traveling" — a place no sale can
  // be filed under — so its levy, licences and price caps would bind nobody.
  it('refuses a travelling company, and says which of the two to fix', async () => {
    const co = (await listCompanies(env, R)).find((c) => c.business === COURT);
    await updateCompany(env, { id: co.id, name: COURT, hold: TRAVELING, court: true }, R);
    await expect(requireCourt(env, COURT, R)).rejects.toThrow(/no region to govern/i);
  });
});

describe('the companies a Court sees', () => {
  it('is every shop in its region, including its own', async () => {
    const list = await courtCompanies(env, 'Whiterun', R);
    expect(list.map((c) => c.business).sort()).toEqual([NEIGHBOUR, COURT].sort());
  });

  it('leaves out shops in another region', async () => {
    const list = await courtCompanies(env, 'Whiterun', R);
    expect(list.some((c) => c.business === OUTSIDER)).toBe(false);
  });

  it('leaves out another realm\'s shop of the same name in the same region', async () => {
    const list = await courtCompanies(env, 'Whiterun', R);
    expect(list.filter((c) => c.business === NEIGHBOUR)).toHaveLength(1);
    expect(list.every((c) => c.realmId === R)).toBe(true);
  });

  it('never carries another shop\'s staff code', async () => {
    const list = await courtCompanies(env, 'Whiterun', R);
    // Holding it would let a Court recruit into a rival's roster.
    expect(list.every((c) => !('joinCode' in c))).toBe(true);
  });
});

describe('opening one shop', () => {
  it('returns its roster and its books', async () => {
    const d = await courtShop(env, 'Whiterun', NEIGHBOUR, R);
    expect(d.business).toBe(NEIGHBOUR);
    expect(d.roster.map((p) => p.character)).toEqual(['Adrianne']);
    expect(d.coffer).toBeDefined();
    expect(d.overview).toBeDefined();
  });

  it('refuses a shop outside the region even when named directly', async () => {
    await expect(courtShop(env, 'Whiterun', OUTSIDER, R)).rejects.toThrow(/does not trade in your region/i);
  });

  it('refuses a shop in another realm named directly', async () => {
    // Same name, same region, wrong realm: the realm scope has to hold.
    const d = await courtShop(env, 'Whiterun', NEIGHBOUR, R);
    expect(d.roster.map((p) => p.character)).toEqual(['Adrianne']);   // not 'Twin'
  });

  it('refuses an empty name rather than guessing', async () => {
    await expect(courtShop(env, 'Whiterun', '', R)).rejects.toThrow(/which company/i);
  });
});

describe('what a roster shows an outsider', () => {
  it('names and roles, never email addresses', async () => {
    const roster = await shopRoster(env, NEIGHBOUR, R);
    expect(roster[0]).toEqual({ character: 'Adrianne', role: 'owner', isOwner: true, status: 'active' });
    expect(roster.every((p) => !('email' in p))).toBe(true);
  });
});

describe('the shared shop snapshot', () => {
  it('is the same shape an admin reads, and carries no staff code', async () => {
    const d = await shopOverview(env, NEIGHBOUR, R);
    expect(Object.keys(d).sort()).toEqual(['business', 'coffer', 'discounts', 'items', 'overview', 'style'].sort());
  });
});

/**
 * The Court's own market report covers everything traded in its region — sales
 * rung up there, and what shops bought FROM there.
 */
describe('the region\'s market report', () => {
  it('counts supply into the region as trade there', async () => {
    await env.DB.prepare(
      `INSERT INTO intake (realm_id, business, ts, item, source_hold, num_items, price_per)
       VALUES (?, ?, '2026-01-01T00:00:00Z', 'Iron Sword', 'Whiterun', 4, 25)`).bind(R, NEIGHBOUR).run();
    const d = await holdReport(env, 'Whiterun', R);
    expect(d.overview.revenue).toBe(100);
    expect(d.overview.itemsSold).toBe(4);
    expect(d.overview.orders).toBe(1);
    // Intake names a vendor, not a registered company, so the supply side has
    // no shop to credit.
    expect(d.overview.activeShops).toBe(0);
  });

  it('ignores supply sourced from another region', async () => {
    await env.DB.prepare(
      `INSERT INTO intake (realm_id, business, ts, item, source_hold, num_items, price_per)
       VALUES (?, ?, '2026-01-01T00:00:00Z', 'Iron Sword', 'The Rift', 9, 99)`).bind(R, NEIGHBOUR).run();
    const d = await holdReport(env, 'Whiterun', R);
    expect(d.overview.revenue).toBe(0);
  });

  /**
   * Supply from a seller nobody registered — an NPC smith, a caravan, a farm.
   * It is real trade in the region and counts toward its revenue, but it can
   * never sit on a company's line, so it gets a bucket of its own rather than
   * leaving the shops table silently short of the region's total.
   */
  it('buckets supply from unregistered sellers on its own', async () => {
    await env.DB.prepare(
      `INSERT INTO intake (realm_id, business, ts, item, source_hold, num_items, price_per, from_business)
       VALUES (?, ?, '2026-01-01T00:00:00Z', 'Iron Sword', 'Whiterun', 4, 25, '')`).bind(R, NEIGHBOUR).run();
    const d = await holdReport(env, 'Whiterun', R);
    expect(d.unregistered).toEqual({ orders: 1, items: 4, revenue: 100 });
    expect(d.businesses).toEqual([]);           // nobody to credit
    expect(d.overview.revenue).toBe(100);       // but the region still earned it
  });

  it('credits a registered supplier to its own line, not the bucket', async () => {
    await env.DB.prepare(
      `INSERT INTO intake (realm_id, business, ts, item, source_hold, num_items, price_per, from_business)
       VALUES (?, ?, '2026-01-01T00:00:00Z', 'Iron Sword', 'Whiterun', 4, 25, ?)`)
      .bind(R, NEIGHBOUR, COURT).run();
    const d = await holdReport(env, 'Whiterun', R);
    expect(d.unregistered.revenue).toBe(0);
    expect(d.businesses).toEqual([{ business: COURT, orders: 1, items: 4, revenue: 100 }]);
  });

  it('leaves out items nothing sold of', async () => {
    // Sourced from the region but never sold there: a row of zeroes is noise
    // between the rows a Court is actually reading.
    await env.DB.prepare(
      `INSERT INTO intake (realm_id, business, ts, item, source_hold, num_items, price_per)
       VALUES (?, ?, '2026-01-01T00:00:00Z', 'Iron Sword', 'Whiterun', 4, 25)`).bind(R, NEIGHBOUR).run();
    const d = await holdReport(env, 'Whiterun', R);
    expect(d.items.every((i) => i.qty > 0)).toBe(true);
    expect(d.items.find((i) => i.item === 'Iron Sword')).toBeUndefined();
  });
});
