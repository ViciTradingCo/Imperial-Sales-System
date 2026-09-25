/**
 * SEARCHING A LOG BY DATE, AND BY WHAT SOMEBODY WROTE IN IT.
 *
 * Three logs — sales, the coffer, deliveries — narrowed by a window of days,
 * and the coffer also by the words on the line. They share `history.js` because
 * they share the ways this goes wrong, and every one of those is quiet:
 *
 *   • A WINDOW THAT DROPS ITS LAST DAY. `to` names a whole day, so the window
 *     has to run to the start of the day AFTER it. Closing it at `ts <= to`
 *     keeps only whatever happened in the first instant of that day — and reads
 *     as "nothing was sold on the 31st", which is the worst way to be wrong.
 *   • A COUNT THAT BELONGS TO A DIFFERENT QUERY than the rows, so the pager
 *     promises pages that are not there.
 *   • A BALANCE THAT MOVES when the list is filtered, which reads as money
 *     having gone missing.
 *   • A DELIVERY CUT IN HALF by a page boundary, since a trip is one card and
 *     several rows.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { ensureDefaultRealm } from '../src/realm.js';
import { registerUser } from '../src/registry.js';
import { createSession } from '../src/sessions.js';
import { dayWindow, pageOf, PAGE_SIZE } from '../src/history.js';
import { routes as businessRoutes } from '../src/routes/business.js';
import { cacheBust } from '../src/cache.js';

let env;
const R = DEFAULT_REALM_ID;
const SHOP = 'The Forge';

const req = (token) => ({ headers: { get: (h) => (h === 'Authorization' ? 'Bearer ' + token : null) } });
const call = (path, token, params = {}) => {
  const u = new URL('https://x' + path);
  Object.entries(params).forEach(([k, v]) => { if (v != null) u.searchParams.set(k, String(v)); });
  return businessRoutes.find((r) => r.method === 'GET' && r.path === path)
    .handler({ request: req(token), env, body: {}, url: u });
};
const sales = (t, p) => call('/sales', t, p);
const coffer = (t, p) => call('/business/coffer', t, p);
const intake = (t, p) => call('/intake', t, p);

let token;
beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of [...REALM_TABLES, 'realms', 'sessions']) await env.DB.prepare('DELETE FROM ' + t).run();
  cacheBust('');
  await ensureDefaultRealm(env);
  await registerUser(env, { email: 'own@x.test', character: 'Marcus', businessName: SHOP, asOwner: true, realmId: R });
  token = (await createSession(env, { email: 'own@x.test' })).token;
});

let seq = 0;
/** A sale at a given instant. `at` is a full ISO string, so edges are testable. */
const sell = (at, n) => env.DB.prepare(
  `INSERT INTO sales (realm_id, business, ts, order_no, customer, hold, items, qty_total, total, employee, status)
   VALUES (?, ?, ?, ?, 'Walk-in', 'Whiterun', '', 1, 10, 'Marcus', '')`)
  .bind(R, SHOP, at, 'S-' + String(n != null ? n : ++seq).padStart(4, '0')).run();

const cofferRow = (at, note, kind = 'deposit', amount = 10) => env.DB.prepare(
  'INSERT INTO coffer_entries (realm_id, business, ts, kind, amount, note) VALUES (?, ?, ?, ?, ?, ?)')
  .bind(R, SHOP, at, kind, amount, note).run();

/** One delivery of `lines` items, sharing an idempotency stem. */
const delivery = async (at, stem, lines) => {
  for (let i = 0; i < lines; i++) {
    await env.DB.prepare(
      `INSERT INTO intake (realm_id, business, ts, item, vendor, source_hold, num_items, price_per, idem, from_business)
       VALUES (?, ?, ?, ?, 'Smith', 'Whiterun', 1, 5, ?, '')`)
      .bind(R, SHOP, at, stem + '-item' + i, stem + '#' + i).run();
  }
};

describe('the window a pair of dates means', () => {
  /**
   * The whole of the last day, not its first instant. This is the bug the
   * half-open window exists to prevent and the one nobody would notice: the
   * figures simply come out a day short.
   */
  it('runs to the START of the day after `to`', () => {
    const w = dayWindow('2026-03-01', '2026-03-31');
    expect(w.from).toBe('2026-03-01T00:00:00.000Z');
    expect(w.to).toBe('2026-04-01T00:00:00.000Z');
  });

  it('is unbounded on a side left blank', () => {
    expect(dayWindow('', '2026-03-31')).toEqual({ from: '', to: '2026-04-01T00:00:00.000Z' });
    expect(dayWindow('2026-03-01', '')).toEqual({ from: '2026-03-01T00:00:00.000Z', to: '' });
    expect(dayWindow('', '')).toEqual({ from: '', to: '' });
  });

  it('treats a date nobody could mean as no bound at all, never as zero', () => {
    for (const bad of ['banana', '2026-13-45', '03/01/2026', '2026-3-1']) {
      expect(dayWindow(bad, bad)).toEqual({ from: '', to: '' });
    }
  });

  it('crosses a month and a year end', () => {
    expect(dayWindow('2026-12-31', '2026-12-31').to).toBe('2027-01-01T00:00:00.000Z');
    expect(dayWindow('2028-02-28', '2028-02-29').to).toBe('2028-03-01T00:00:00.000Z'); // a leap year
  });
});

describe('the sales log by date', () => {
  beforeEach(async () => {
    await sell('2026-02-28T23:59:59.000Z', 1);
    await sell('2026-03-01T00:00:00.000Z', 2);   // the first instant of the window
    await sell('2026-03-15T12:00:00.000Z', 3);
    await sell('2026-03-31T23:59:59.000Z', 4);   // the last instant of the last day
    await sell('2026-04-01T00:00:00.000Z', 5);
  });

  it('keeps both edges of the window and nothing outside it', async () => {
    const r = await sales(token, { from: '2026-03-01', to: '2026-03-31' });
    expect(r.sales.map((s) => s.orderNo)).toEqual(['S-0004', 'S-0003', 'S-0002']);
    expect(r.total).toBe(3);
  });

  it('keeps the whole of a single day asked for on both sides', async () => {
    const r = await sales(token, { from: '2026-03-31', to: '2026-03-31' });
    expect(r.total).toBe(1);
    expect(r.sales[0].orderNo).toBe('S-0004');   // 23:59:59 is still that day
  });

  it('is open-ended from one side', async () => {
    expect((await sales(token, { from: '2026-03-01' })).total).toBe(4);
    expect((await sales(token, { to: '2026-03-01' })).total).toBe(2);
  });

  it('narrows a text search rather than replacing it', async () => {
    await sell('2026-03-10T00:00:00.000Z', 900);
    expect((await sales(token, { q: 's-0900' })).total).toBe(1);
    expect((await sales(token, { q: 's-0900', from: '2026-03-01', to: '2026-03-31' })).total).toBe(1);
    expect((await sales(token, { q: 's-0900', from: '2026-04-01' })).total).toBe(0);
  });

  it('pages within the window, counting only what is in it', async () => {
    for (let i = 100; i < 140; i++) await sell('2026-05-0' + (1 + (i % 9)) + 'T00:00:00.000Z', i);
    const r = await sales(token, { from: '2026-05-01', to: '2026-05-31', page: 2 });
    expect(r.total).toBe(40);
    expect(r.pages).toBe(2);
    expect(r.sales.length).toBe(40 - PAGE_SIZE);
  });
});

describe('the coffer by note and by date', () => {
  beforeEach(async () => {
    await cofferRow('2026-03-02T00:00:00.000Z', 'Bought a cart from Ulfberth', 'withdrawal', -80);
    await cofferRow('2026-03-09T00:00:00.000Z', 'Roof repairs', 'withdrawal', -20);
    await cofferRow('2026-04-02T00:00:00.000Z', 'Cart wheel replaced', 'withdrawal', -15);
    await cofferRow('2026-04-09T00:00:00.000Z', '', 'sale', 40);
  });

  it('finds a line by what was written on it', async () => {
    const r = await coffer(token, { q: 'cart' });
    expect(r.total).toBe(2);
    expect(r.entries.map((e) => e.note)).toEqual(['Cart wheel replaced', 'Bought a cart from Ulfberth']);
  });

  it('matches the note whatever case it was typed in', async () => {
    expect((await coffer(token, { q: 'ULFBERTH' })).total).toBe(1);
  });

  it('matches the kind too, so “sale” finds the sale lines', async () => {
    expect((await coffer(token, { q: 'sale' })).total).toBe(1);
  });

  it('narrows the note search by date', async () => {
    expect((await coffer(token, { q: 'cart', from: '2026-04-01' })).total).toBe(1);
    expect((await coffer(token, { q: 'cart', to: '2026-03-31' })).total).toBe(1);
  });

  it('survives a line with no note at all', async () => {
    const r = await coffer(token, { q: 'nothing-matches-this' });
    expect(r.total).toBe(0);
    expect(r.entries).toEqual([]);
  });

  /**
   * THE BALANCE IS THE WHOLE COFFER, always. It is what the shop HAS; a figure
   * that moved when somebody narrowed the list to one month would read as money
   * having gone missing.
   */
  it('reports the whole balance however the list is filtered', async () => {
    const all = await coffer(token);
    expect(all.balance).toBe(-75);
    expect((await coffer(token, { q: 'cart' })).balance).toBe(-75);
    expect((await coffer(token, { from: '2026-04-01' })).balance).toBe(-75);
    expect((await coffer(token, { from: '2030-01-01' })).balance).toBe(-75);
  });
});

describe('deliveries by date, paged by trip', () => {
  it('keeps every line of the trips on the page', async () => {
    for (let i = 1; i <= 30; i++) await delivery('2026-03-0' + (1 + (i % 9)) + 'T00:00:00.000Z', 'trip' + i, 3);
    const r = await intake(token, { page: 1 });
    expect(r.total).toBe(30);                       // thirty TRIPS, not ninety rows
    expect(r.pages).toBe(2);
    const trips = new Set(r.intake.map((l) => l.delivery));
    expect(trips.size).toBe(PAGE_SIZE);
    // Every trip on the page brought all three of its lines — none was cut in
    // half by the page boundary.
    for (const t of trips) expect(r.intake.filter((l) => l.delivery === t).length).toBe(3);
  });

  it('does not repeat a trip on the next page', async () => {
    for (let i = 1; i <= 30; i++) await delivery('2026-03-0' + (1 + (i % 9)) + 'T00:00:00.000Z', 'trip' + i, 2);
    const p1 = new Set((await intake(token, { page: 1 })).intake.map((l) => l.delivery));
    const p2 = new Set((await intake(token, { page: 2 })).intake.map((l) => l.delivery));
    expect(p1.size + p2.size).toBe(30);
    for (const t of p2) expect(p1.has(t)).toBe(false);
  });

  it('narrows to a window of days', async () => {
    await delivery('2026-02-28T12:00:00.000Z', 'feb', 2);
    await delivery('2026-03-31T23:00:00.000Z', 'mar', 2);
    await delivery('2026-04-01T01:00:00.000Z', 'apr', 2);
    const r = await intake(token, { from: '2026-03-01', to: '2026-03-31' });
    expect(r.total).toBe(1);
    expect(new Set(r.intake.map((l) => l.delivery))).toEqual(new Set(['mar']));
  });

  /**
   * A single-item delivery from before the multi-line form has no idempotency
   * key, and two of them on one day were never one trip — so each stands alone
   * and must still be counted and paged as its own.
   */
  it('counts a keyless legacy row as a trip of its own', async () => {
    for (let i = 0; i < 3; i++) {
      await env.DB.prepare(
        `INSERT INTO intake (realm_id, business, ts, item, vendor, source_hold, num_items, price_per, idem, from_business)
         VALUES (?, ?, '2026-03-05T00:00:00.000Z', ?, 'Smith', 'Whiterun', 1, 5, NULL, '')`)
        .bind(R, SHOP, 'old-' + i).run();
    }
    const r = await intake(token, {});
    expect(r.total).toBe(3);
    expect(new Set(r.intake.map((l) => l.delivery)).size).toBe(3);
  });
});

/** The clamping every one of them shares, on its own. */
describe('which page a request gets', () => {
  it('is clamped to what exists, never answered with nothing', () => {
    expect(pageOf(100, 99).page).toBe(4);
    expect(pageOf(100, 0).page).toBe(1);
    expect(pageOf(100, 'banana').page).toBe(1);
    expect(pageOf(0, 5)).toMatchObject({ page: 1, pages: 1, offset: 0 });
  });

  it('offsets by whole pages', () => {
    expect(pageOf(100, 3).offset).toBe(2 * PAGE_SIZE);
  });
});
