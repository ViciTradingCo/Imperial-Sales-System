/**
 * THE WHOLE SALES HISTORY, not the last page of it.
 *
 * The log answered with the 25 most recent sales and had no way to ask for the
 * 26th, so a shop's own trade fell off the end of its own screen the week it
 * got busy. The rows were never lost — the CSV export has always carried every
 * one — but an owner could not LOOK at them.
 *
 * Paging is easy to get subtly wrong and the mistakes all look like small ones:
 * a row that appears on two pages, a row on none, a last page that is empty, a
 * count that belongs to a different query than the rows do. So what is asserted
 * is the whole walk — every page collected and compared against every sale the
 * shop made, by order number, in order:
 *
 *   • EVERY row is reachable, exactly ONCE;
 *   • the order is newest-first and holds ACROSS the page boundary;
 *   • the total counts the same rows the pager walks, searching or not;
 *   • a page past the end lands on the last real one rather than on nothing;
 *   • one shop's history is its own, and one realm's is its own.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { ensureDefaultRealm, createRealm } from '../src/realm.js';
import { registerUser } from '../src/registry.js';
import { findUserByEmail } from '../src/users.js';
import { createSession } from '../src/sessions.js';
import { listSales, countSales } from '../src/sales.js';
import { routes as businessRoutes } from '../src/routes/business.js';
import { cacheBust } from '../src/cache.js';

let env;
const R = DEFAULT_REALM_ID;
const SHOP = 'The Forge';
const RIVAL = 'Riverwood Trader';

const req = (token) => ({ headers: { get: (h) => (h === 'Authorization' ? 'Bearer ' + token : null) } });
const route = businessRoutes.find((r) => r.method === 'GET' && r.path === '/sales');
const ask = (token, { q, page } = {}) => route.handler({
  request: req(token), env, body: {},
  url: new URL('https://x/sales?q=' + encodeURIComponent(q || '') + '&page=' + (page == null ? '' : page)),
});

let token = {};

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of [...REALM_TABLES, 'realms', 'sessions']) await env.DB.prepare('DELETE FROM ' + t).run();
  cacheBust('');
  await ensureDefaultRealm(env);
  await registerUser(env, { email: 'own@x.test', character: 'Marcus', businessName: SHOP, asOwner: true, realmId: R });
  await registerUser(env, { email: 'rival@x.test', character: 'Lucan', businessName: RIVAL, asOwner: true, realmId: R });
  token = {
    owner: (await createSession(env, { email: 'own@x.test' })).token,
    rival: (await createSession(env, { email: 'rival@x.test' })).token,
  };
});

let seq = 0;
/** A sale on the books. `n` orders it, so the newest-first walk is checkable. */
async function sell(n, { business = SHOP, realmId = R, customer = 'Walk-in', employee = 'Marcus' } = {}) {
  seq++;
  await env.DB.prepare(
    `INSERT INTO sales (realm_id, business, ts, order_no, customer, hold, items, qty_total, total, employee, status)
     VALUES (?, ?, ?, ?, ?, 'Whiterun', '', 1, 10, ?, '')`)
    .bind(realmId, business, '2026-01-01T00:00:00Z', 'S-' + String(n).padStart(4, '0'), customer, employee).run();
}

/** Every order number the shop made, newest first — what any walk must equal. */
const expected = (count) => Array.from({ length: count }, (_, i) => 'S-' + String(count - i).padStart(4, '0'));

/** Walks every page of a lookup and returns what it saw, in the order it saw it. */
async function walk(tok, q) {
  const first = await ask(tok, { q, page: 1 });
  const seen = first.sales.map((s) => s.orderNo);
  for (let p = 2; p <= first.pages; p++) {
    const r = await ask(tok, { q, page: p });
    seen.push(...r.sales.map((s) => s.orderNo));
  }
  return { seen, meta: first };
}

describe('walking the whole history', () => {
  it('reaches every sale exactly once, newest first', async () => {
    for (let i = 1; i <= 64; i++) await sell(i);       // more than two pages of 25
    const { seen, meta } = await walk(token.owner);
    expect(meta.total).toBe(64);
    expect(meta.pages).toBe(3);
    expect(seen).toEqual(expected(64));                // order, completeness and no repeats, at once
    expect(new Set(seen).size).toBe(64);
  });

  /**
   * The boundary itself. Page one ending where page two begins is the join that
   * an off-by-one breaks, and it breaks quietly: a duplicated row reads as a
   * real duplicate sale, and a skipped one is simply never seen again.
   */
  it('does not drop or repeat a row across the page boundary', async () => {
    for (let i = 1; i <= 30; i++) await sell(i);
    const p1 = await ask(token.owner, { page: 1 });
    const p2 = await ask(token.owner, { page: 2 });
    expect(p1.sales.length).toBe(25);
    expect(p2.sales.length).toBe(5);
    expect(p1.sales[24].orderNo).toBe('S-0006');
    expect(p2.sales[0].orderNo).toBe('S-0005');        // the very next one, not a repeat
  });

  it('is one page when the shop has few enough sales for one', async () => {
    for (let i = 1; i <= 4; i++) await sell(i);
    const r = await ask(token.owner, { page: 1 });
    expect(r.total).toBe(4);
    expect(r.pages).toBe(1);
    expect(r.sales.length).toBe(4);
  });

  it('is an empty page one, not an error, for a shop that has sold nothing', async () => {
    const r = await ask(token.owner, { page: 1 });
    expect(r.sales).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.pages).toBe(1);
    expect(r.page).toBe(1);
  });

  it('says how big a page is, so the screen need not assume', async () => {
    await sell(1);
    expect((await ask(token.owner, { page: 1 })).pageSize).toBe(25);
  });
});

describe('a page number that does not exist', () => {
  beforeEach(async () => { for (let i = 1; i <= 30; i++) await sell(i); });

  /**
   * Clamped, not obeyed. Answering a page past the end with nothing looks
   * exactly like an empty history, which is the one thing this feature exists
   * to stop somebody believing.
   */
  it('past the end lands on the last real page', async () => {
    const r = await ask(token.owner, { page: 99 });
    expect(r.page).toBe(2);
    expect(r.sales.length).toBe(5);
  });

  it('below the first lands on page one', async () => {
    for (const p of [0, -3]) {
      const r = await ask(token.owner, { page: p });
      expect(r.page).toBe(1);
      expect(r.sales[0].orderNo).toBe('S-0030');
    }
  });

  it('and nonsense is page one too', async () => {
    for (const p of ['', 'banana', '2.7']) {
      const r = await ask(token.owner, { page: p });
      expect(r.page).toBe(p === '2.7' ? 2 : 1);
    }
  });
});

/**
 * A search pages over ITS OWN matches. The count and the rows have to come from
 * one condition — two copies of it is how a pager ends up promising four pages
 * of a three-page result.
 */
describe('searching the history', () => {
  beforeEach(async () => {
    for (let i = 1; i <= 40; i++) await sell(i, { customer: i % 2 ? 'Lydia' : 'Uthgerd' });
  });

  it('counts and walks the matches, not the whole log', async () => {
    const { seen, meta } = await walk(token.owner, 'lydia');
    expect(meta.total).toBe(20);
    expect(meta.pages).toBe(1);
    expect(seen.length).toBe(20);
    expect(new Set(seen).size).toBe(20);
  });

  it('pages a search that runs past one page', async () => {
    for (let i = 41; i <= 80; i++) await sell(i, { customer: 'Lydia' });
    const { seen, meta } = await walk(token.owner, 'lydia');
    expect(meta.total).toBe(60);
    expect(meta.pages).toBe(3);
    expect(seen.length).toBe(60);
    expect(new Set(seen).size).toBe(60);
    expect(seen[0]).toBe('S-0080');                    // still newest first
  });

  it('finds by employee and by order number as well as by customer', async () => {
    await sell(99, { employee: 'Sera' });
    expect((await ask(token.owner, { q: 'sera' })).total).toBe(1);
    expect((await ask(token.owner, { q: 's-0099' })).total).toBe(1);
  });

  it('answers an empty page one when nothing matches', async () => {
    const r = await ask(token.owner, { q: 'nobody-by-that-name' });
    expect(r.total).toBe(0);
    expect(r.sales).toEqual([]);
    expect(r.pages).toBe(1);
  });
});

describe('whose history it is', () => {
  it('is the caller’s own shop, however deep they page', async () => {
    for (let i = 1; i <= 30; i++) await sell(i);
    for (let i = 1; i <= 30; i++) await sell(100 + i, { business: RIVAL });
    const mine = await walk(token.owner);
    expect(mine.meta.total).toBe(30);
    expect(mine.seen.every((o) => Number(o.slice(2)) <= 30)).toBe(true);

    const theirs = await walk(token.rival);
    expect(theirs.meta.total).toBe(30);
    expect(theirs.seen.every((o) => Number(o.slice(2)) > 100)).toBe(true);
  });

  /**
   * And its own realm's. The count is a second query and so a second place the
   * realm filter could be left off — which would report a total from the whole
   * deployment over rows from one realm.
   */
  it('and its own realm’s, in both the rows and the count', async () => {
    const other = await createRealm(env, { name: 'Second' });
    for (let i = 1; i <= 5; i++) await sell(i);
    for (let i = 1; i <= 9; i++) await sell(200 + i, { realmId: other.id });
    const r = await ask(token.owner, { page: 1 });
    expect(r.total).toBe(5);
    expect(r.sales.length).toBe(5);
    expect(await countSales(env, SHOP, '', other.id)).toBe(9);
    expect(await listSales(env, SHOP, '', other.id, 25, 0)).toHaveLength(9);
  });
});

/**
 * The module under the route. `listSales` still answers with an ARRAY — several
 * callers want rows and nothing else — and the total is its own function, so
 * the two are checked to agree rather than assumed to.
 */
describe('the module’s own shape', () => {
  it('lists an array and counts separately, over the same rows', async () => {
    for (let i = 1; i <= 7; i++) await sell(i);
    const rows = await listSales(env, SHOP, '', R);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(7);
    expect(await countSales(env, SHOP, '', R)).toBe(7);
  });

  it('offsets from the newest, so the two halves meet exactly', async () => {
    for (let i = 1; i <= 10; i++) await sell(i);
    const head = (await listSales(env, SHOP, '', R, 4, 0)).map((s) => s.orderNo);
    const tail = (await listSales(env, SHOP, '', R, 4, 4)).map((s) => s.orderNo);
    expect(head).toEqual(['S-0010', 'S-0009', 'S-0008', 'S-0007']);
    expect(tail).toEqual(['S-0006', 'S-0005', 'S-0004', 'S-0003']);
  });
});
