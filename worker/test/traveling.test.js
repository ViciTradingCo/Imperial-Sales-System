/**
 * TRAVELING — a company with no fixed region.
 *
 * The word is stored in the same column a region is, which is what makes it
 * worth testing rather than reading: everything that asks "where is this shop"
 * gets an answer that looks like a place and is not one. So what is asserted
 * here is the two directions that must hold.
 *
 * It must never become a REGION: no realm can name one this, or "based
 * nowhere" and "based in Traveling" stop being distinguishable, and a Court
 * cannot govern it, because a levy on a place no sale can be filed under binds
 * nobody.
 *
 * And it must never cost a shop its TRADE: a travelling shop rings every sale
 * up in the region it is standing in, so those sales count towards that
 * region's market exactly as a local shop's would. What it loses is a market
 * report OF ITS OWN — there is no one place to report on — which the route
 * says in its own words rather than borrowing "no region set", a shop's cue to
 * go and ask an admin to fix something.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { ensureDefaultRealm } from '../src/realm.js';
import { TRAVELING, isTraveling, readRegions, writeRegions } from '../src/regions.js';
import { registerUser, updateCompany, listCompanies, findBusinessMeta } from '../src/registry.js';
import { createSession } from '../src/sessions.js';
import { routes as businessRoutes } from '../src/routes/business.js';
import { holdReport } from '../src/market.js';
import { encodeSaleItems } from '../src/sales.js';
import { importItemIndex } from '../src/item-index.js';
import { cacheBust } from '../src/cache.js';

let env;
const R = DEFAULT_REALM_ID;
const CARAVAN = 'Khajiit Caravan';
const SETTLED = 'Iron Hearth';
const HOMELESS = 'No Fixed Abode';

/** A request as the Worker receives it, carrying one of our session tokens. */
const req = (token) => ({ headers: { get: (h) => (h === 'Authorization' ? 'Bearer ' + token : null) } });

const weekRoute = businessRoutes.find((r) => r.method === 'GET' && r.path === '/market/week');

async function callWeek(email) {
  const { token } = await createSession(env, { email, name: 'Tester', uid: 'u-' + email });
  return weekRoute.handler({ request: req(token), env });
}

/** Sets a company's region, leaving everything else about it alone. */
async function setRegion(business, hold) {
  const co = (await listCompanies(env, R)).find((c) => c.business === business);
  await updateCompany(env, { id: co.id, name: business, hold, perpetual: true }, R);
}

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of [...REALM_TABLES, 'realms', 'sessions']) await env.DB.prepare('DELETE FROM ' + t).run();
  cacheBust('');
  await ensureDefaultRealm(env);
  await importItemIndex(env, [{ name: 'Moon Sugar', baseValue: 20 }], R);
  await registerUser(env, { email: 'ri@x.test', character: 'Ri’saad', businessName: CARAVAN, asOwner: true, hold: 'Whiterun', realmId: R });
  await registerUser(env, { email: 'smith@x.test', character: 'Adrianne', businessName: SETTLED, asOwner: true, hold: 'Whiterun', realmId: R });
  await registerUser(env, { email: 'nowhere@x.test', character: 'Nobody', businessName: HOMELESS, asOwner: true, hold: '', realmId: R });
  await setRegion(CARAVAN, TRAVELING);
});

describe('recognising the word', () => {
  it('reads it however an admin typed it', () => {
    for (const v of ['Traveling', 'traveling', '  TRAVELING  ']) expect(isTraveling(v), v).toBe(true);
  });

  it('is not fooled by a region that merely mentions travel', () => {
    for (const v of ['', 'Whiterun', 'Travelers Rest', 'Travelling']) expect(isTraveling(v), v).toBe(false);
  });

  it('survives the round trip through the company record', async () => {
    expect((await findBusinessMeta(env, CARAVAN, R)).hold).toBe(TRAVELING);
  });
});

describe('it cannot become a region', () => {
  it('refuses a realm that tries to name one Traveling, in any case', async () => {
    for (const v of ['Traveling', 'traveling']) {
      await expect(writeRegions(env, ['Whiterun', v], R), v).rejects.toThrow(/reserved/i);
    }
  });

  it('leaves the realm’s existing list untouched when it refuses', async () => {
    await writeRegions(env, ['Whiterun', 'The Rift'], R);
    await expect(writeRegions(env, ['Skyrim', TRAVELING], R)).rejects.toThrow(/reserved/i);
    expect(await readRegions(env, R)).toEqual(['Whiterun', 'The Rift']);
  });

  it('so the register never offers it as a place a sale happened', async () => {
    await writeRegions(env, ['Whiterun', 'The Rift'], R);
    expect(await readRegions(env, R)).not.toContain(TRAVELING);
  });
});

describe('the weekly market report it is not given', () => {
  it('tells a travelling shop why, in its own words', async () => {
    const d = await callWeek('ri@x.test');
    expect(d.traveling).toBe(true);
    expect(d.noRegion).toBe(true);
    expect(d.items).toEqual([]);
  });

  it('does not confuse it with a shop whose region was never set', async () => {
    const d = await callWeek('nowhere@x.test');
    expect(d.noRegion).toBe(true);
    expect(d.traveling).toBeUndefined();
  });

  it('still reports for a shop that has a region', async () => {
    const d = await callWeek('smith@x.test');
    expect(d.noRegion).toBeUndefined();
    expect(d.traveling).toBeUndefined();
    expect(d.week.from).toBeTruthy();
  });
});

describe('its trade still belongs to the region it happened in', () => {
  it('counts a travelling shop’s sales towards that region’s market', async () => {
    // Rung up in The Rift by a shop based nowhere: the sale happened there, so
    // The Rift's market is where it counts. Nothing about the seller's own
    // record enters into it — the region is a property of the SALE.
    await env.DB.prepare(
      `INSERT INTO sales (realm_id, business, ts, order_no, hold, items, qty_total, total, status)
       VALUES (?, ?, ?, 'S-1', 'The Rift', ?, 4, 100, 'OK')`)
      .bind(R, CARAVAN, new Date().toISOString(), encodeSaleItems([{ item: 'Moon Sugar', qty: 4, price: 25 }])).run();

    const report = await holdReport(env, 'The Rift', R);
    expect(report.overview.revenue).toBe(100);
    expect(report.businesses.map((b) => b.business)).toContain(CARAVAN);
  });
});
