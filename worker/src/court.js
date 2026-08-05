/**
 * The Court as a REGION'S GOVERNMENT.
 *
 * `oversight.js` is a Court looking; this is a Court governing. Its instruments:
 *
 *   • a LEVY on trade — accrued as a debt, never taken;
 *   • LICENCES and sanctions, up to barring a shop from trading;
 *   • PRICE CONTROLS, a floor and ceiling per item;
 *   • a NOTICE to every shop in the region;
 *   • a TREASURY of categorised public spending;
 *   • a view of what the whole region holds.
 *
 * Everything is keyed by REGION, not by the Court company. A Court renamed, or
 * the flag moved to a different company, leaves the region's rules and its books
 * exactly where they were — the authority belongs to the seat, not the holder.
 *
 * THE MONEY NEVER MOVES ON ITS OWN. A levy records what a shop owes; a Court
 * marks it paid when it is actually paid, in whatever way the fiction settles
 * it. Automatic transfers between players' coffers would be the system deciding
 * an outcome that the roleplay is there to decide.
 */
import { getDb } from './db.js';
import { listCompanies } from './registry.js';
import { coin } from './money.js';

/** What public money may be spent on. Served to the client so there is one list. */
export const SPEND_CATEGORIES = [
  'Guards & security',
  'Roads & infrastructure',
  'Festivals & events',
  'Relief & charity',
  'Diplomacy & tribute',
  'Other',
];

/** A shop's standing with its Court, worst to best. */
export const STANDINGS = ['banned', 'restricted', 'none', 'licensed'];

const now = () => new Date().toISOString();
const key = (s) => String(s || '').trim().toLowerCase();
// Every court figure is a whole coin, rounded down — see money.js.
const money2 = coin;

/* ---- settings: the levy rate and the region's notice ---- */

export async function readCourtSettings(env, hold, realmId) {
  const db = await getDb(env);
  const r = await db.prepare('SELECT tax_percent, notice FROM court_settings WHERE realm_id = ? AND lower(hold) = ?')
    .bind(realmId, key(hold)).first();
  return {
    hold,
    // 0 is not "unset" — it is the levy switched OFF, and checkout leans on
    // that to skip the whole calculation.
    taxPercent: r ? Number(r.tax_percent) || 0 : 0,
    notice: r ? String(r.notice || '') : '',
  };
}

export async function writeCourtSettings(env, hold, { taxPercent, notice }, realmId) {
  const cur = await readCourtSettings(env, hold, realmId);
  let pct = cur.taxPercent;
  if (taxPercent !== undefined) {
    pct = Number(taxPercent);
    if (!isFinite(pct) || pct < 0 || pct > 100) throw new Error('The levy must be between 0 and 100 percent.');
    pct = Math.round(pct * 100) / 100;
  }
  const text = notice === undefined ? cur.notice : String(notice || '').trim().slice(0, 1000);
  const db = await getDb(env);
  await db.prepare(
    `INSERT INTO court_settings (realm_id, hold, tax_percent, notice) VALUES (?, ?, ?, ?)
     ON CONFLICT (realm_id, hold) DO UPDATE SET tax_percent = excluded.tax_percent, notice = excluded.notice`)
    .bind(realmId, hold, pct, text).run();
  return readCourtSettings(env, hold, realmId);
}

/* ---- licences and sanctions ---- */

/**
 * Every shop in the region with the standing its Court has given it.
 *
 * A shop with no ruling reads 'none', which is deliberately NOT 'licensed': a
 * seal has to be granted to mean anything, and defaulting to one would put a
 * Court's endorsement on shops it has never looked at.
 */
export async function courtStandings(env, hold, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    'SELECT business, standing, note, updated FROM court_status WHERE realm_id = ? AND lower(hold) = ?')
    .bind(realmId, key(hold)).all();
  const byShop = new Map((results || []).map((r) => [key(r.business), r]));
  const inRegion = (await listCompanies(env, realmId)).filter((c) => key(c.hold) === key(hold));
  return inRegion.map((c) => {
    const r = byShop.get(key(c.business));
    return {
      business: c.business,
      court: c.court,
      standing: r ? String(r.standing || 'none') : 'none',
      note: r ? String(r.note || '') : '',
      updated: r ? String(r.updated || '') : '',
    };
  });
}

export async function setCourtStanding(env, hold, { business, standing, note }, realmId) {
  const name = String(business || '').trim();
  if (!name) throw new Error('Which company?');
  const value = String(standing || '').trim().toLowerCase();
  if (!STANDINGS.includes(value)) throw new Error('Unknown standing "' + standing + '".');
  // The region is the boundary: a Court rules on the shops trading in it.
  const inRegion = await courtStandings(env, hold, realmId);
  const match = inRegion.find((c) => key(c.business) === key(name));
  if (!match) {
    const e = new Error('"' + name + '" does not trade in your region.');
    e.forbidden = true; throw e;
  }
  if (match.court && value === 'banned') {
    throw new Error('A Court cannot bar itself from trading.');
  }
  const db = await getDb(env);
  await db.prepare(
    `INSERT INTO court_status (realm_id, hold, business, standing, note, updated) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (realm_id, business) DO UPDATE SET
       hold = excluded.hold, standing = excluded.standing, note = excluded.note, updated = excluded.updated`)
    .bind(realmId, hold, match.business, value, String(note || '').trim().slice(0, 300), now()).run();
  return courtStandings(env, hold, realmId);
}

/**
 * One shop's standing, for the register and the storefront to act on.
 *
 * Verifies the ruling still applies to where the shop actually trades: a shop
 * that has moved to another region is out of its old Court's reach, and a stale
 * row must not follow it there.
 */
export async function standingOf(env, business, hold, realmId) {
  if (!hold) return 'none';
  const db = await getDb(env);
  const r = await db.prepare('SELECT standing, hold FROM court_status WHERE realm_id = ? AND lower(business) = ?')
    .bind(realmId, key(business)).first();
  if (!r || key(r.hold) !== key(hold)) return 'none';
  return String(r.standing || 'none');
}

/* ---- price controls ---- */

export async function courtPrices(env, hold, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    'SELECT item, min_price, max_price FROM court_price WHERE realm_id = ? AND lower(hold) = ? ORDER BY item COLLATE NOCASE')
    .bind(realmId, key(hold)).all();
  return (results || []).map((r) => ({
    item: r.item,
    min: r.min_price == null ? null : Number(r.min_price),
    max: r.max_price == null ? null : Number(r.max_price),
  }));
}

/** Sets, or with both bounds blank REMOVES, the control on one item. */
export async function setCourtPrice(env, hold, { item, min, max }, realmId) {
  const name = String(item || '').trim();
  if (!name) throw new Error('Which item?');
  const parse = (v) => {
    if (v === undefined || v === null || String(v).trim() === '') return null;
    const n = Number(v);
    if (!isFinite(n) || n < 0) throw new Error('A price control must be a number ≥ 0.');
    return money2(n);
  };
  const lo = parse(min);
  const hi = parse(max);
  if (lo != null && hi != null && lo > hi) {
    throw new Error('The floor cannot be above the ceiling.');
  }
  const db = await getDb(env);
  if (lo == null && hi == null) {
    await db.prepare('DELETE FROM court_price WHERE realm_id = ? AND lower(hold) = ? AND lower(item) = ?')
      .bind(realmId, key(hold), key(name)).run();
  } else {
    await db.prepare(
      `INSERT INTO court_price (realm_id, hold, item, min_price, max_price, updated) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (realm_id, hold, item) DO UPDATE SET
         min_price = excluded.min_price, max_price = excluded.max_price, updated = excluded.updated`)
      .bind(realmId, hold, name, lo, hi, now()).run();
  }
  return courtPrices(env, hold, realmId);
}

/* ---- what a sale must obey ---- */

/**
 * The rules in force in a region, or null when there are none to apply.
 *
 * Null when no company in the region carries the Court flag: rules outlive a
 * rename, but not the office itself. Checkout reads this once and, when it is
 * null, does no further work.
 */
export async function courtRules(env, hold, realmId) {
  if (!hold) return null;
  const db = await getDb(env);
  const seat = await db.prepare(
    'SELECT business FROM companies WHERE realm_id = ? AND lower(hold) = ? AND court = 1 LIMIT 1')
    .bind(realmId, key(hold)).first();
  if (!seat) return null;
  const settings = await readCourtSettings(env, hold, realmId);
  const prices = await courtPrices(env, hold, realmId);
  return {
    hold,
    seat: seat.business,
    taxPercent: settings.taxPercent,
    // A Map keyed the way item names are compared everywhere else.
    prices: new Map(prices.map((p) => [key(p.item), p])),
  };
}

/**
 * Records what a sale owes the Court. Returns 0 when the levy is off, and
 * writes nothing — the whole point of treating 0 as DISABLED rather than as a
 * rate that happens to be zero.
 */
export async function accrueLevy(env, rules, { business, total, orderNo }, realmId) {
  if (!rules || !rules.taxPercent) return 0;
  if (key(business) === key(rules.seat)) return 0;   // a Court does not tax itself
  const amount = money2((Number(total) || 0) * rules.taxPercent / 100);
  if (!amount) return 0;
  const db = await getDb(env);
  await db.prepare(
    `INSERT INTO court_dues (realm_id, hold, business, ts, kind, amount, note) VALUES (?, ?, ?, ?, 'levy', ?, ?)`)
    .bind(realmId, rules.hold, business, now(), amount, orderNo || '').run();
  return amount;
}

/* ---- the dues ledger ---- */

/** What each shop in the region owes: levies less payments. */
export async function courtDues(env, hold, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    `SELECT business, COALESCE(SUM(amount), 0) AS owed, COUNT(*) AS entries
       FROM court_dues WHERE realm_id = ? AND lower(hold) = ?
      GROUP BY business ORDER BY owed DESC`).bind(realmId, key(hold)).all();
  const shops = (results || []).map((r) => ({
    business: r.business, owed: money2(r.owed), entries: r.entries,
  }));
  return { shops, total: money2(shops.reduce((n, s) => n + s.owed, 0)) };
}

/** One shop's levy history, newest first. */
export async function courtDuesFor(env, hold, business, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    `SELECT ts, kind, amount, note FROM court_dues
      WHERE realm_id = ? AND lower(hold) = ? AND lower(business) = ?
      ORDER BY id DESC LIMIT 100`).bind(realmId, key(hold), key(business)).all();
  return results || [];
}

/**
 * Records a payment against what a shop owes — and CREDITS the Court's coffer,
 * because the money really did arrive. This is the one place a levy becomes
 * money, and it happens only when a Court says it has.
 */
export async function recordDuesPayment(env, hold, { business, amount, note }, realmId, seat) {
  const name = String(business || '').trim();
  if (!name) throw new Error('Which company?');
  const paid = money2(Number(amount));
  if (!isFinite(paid) || paid <= 0) throw new Error('Enter an amount greater than zero.');
  const db = await getDb(env);
  const stmts = [
    db.prepare(`INSERT INTO court_dues (realm_id, hold, business, ts, kind, amount, note) VALUES (?, ?, ?, ?, 'payment', ?, ?)`)
      .bind(realmId, hold, name, now(), -paid, String(note || '').trim().slice(0, 200)),
  ];
  if (seat) {
    stmts.push(db.prepare(
      `INSERT INTO coffer_entries (realm_id, business, ts, kind, amount, note) VALUES (?, ?, ?, 'levy', ?, ?)`)
      .bind(realmId, seat, now(), paid, 'Levy from ' + name));
  }
  await db.batch(stmts);
  return courtDues(env, hold, realmId);
}

/* ---- the treasury ---- */

export async function courtSpending(env, hold, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    `SELECT ts, category, amount, note FROM court_spend WHERE realm_id = ? AND lower(hold) = ?
      ORDER BY id DESC LIMIT 100`).bind(realmId, key(hold)).all();
  const rows = results || [];
  const byCategory = new Map();
  rows.forEach((r) => byCategory.set(r.category, money2((byCategory.get(r.category) || 0) + Number(r.amount || 0))));
  return {
    entries: rows,
    byCategory: [...byCategory.entries()].map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount),
    total: money2(rows.reduce((n, r) => n + Number(r.amount || 0), 0)),
    categories: SPEND_CATEGORIES,
  };
}

/**
 * Spends public money. Debits the Court's own coffer in the same batch, so the
 * treasury record and the Court's accounts can never tell different stories.
 */
export async function recordCourtSpend(env, hold, { category, amount, note }, realmId, seat) {
  const cat = SPEND_CATEGORIES.includes(String(category || '').trim())
    ? String(category).trim()
    : SPEND_CATEGORIES[SPEND_CATEGORIES.length - 1];
  const spent = money2(Number(amount));
  if (!isFinite(spent) || spent <= 0) throw new Error('Enter an amount greater than zero.');
  const text = String(note || '').trim().slice(0, 200);
  const db = await getDb(env);
  await db.batch([
    db.prepare(`INSERT INTO court_spend (realm_id, hold, ts, category, amount, note) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(realmId, hold, now(), cat, spent, text),
    db.prepare(`INSERT INTO coffer_entries (realm_id, business, ts, kind, amount, note) VALUES (?, ?, ?, 'court-spend', ?, ?)`)
      .bind(realmId, seat, now(), -spent, cat + (text ? ': ' + text : '')),
  ]);
  return courtSpending(env, hold, realmId);
}

/* ---- what the region holds ---- */

/**
 * Stock across every shop in the region, by item — so a Court can see a
 * shortage forming before it becomes one.
 *
 * Ingredients are counted separately rather than folded in: a region holding
 * two hundred iron ingots that are all somebody's crafting stock is not a
 * region with two hundred iron ingots for sale.
 */
export async function courtStock(env, hold, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    `SELECT i.item AS item,
            COALESCE(SUM(CASE WHEN i.ingredient = 0 THEN i.stock ELSE 0 END), 0) AS forSale,
            COALESCE(SUM(CASE WHEN i.ingredient = 1 THEN i.stock ELSE 0 END), 0) AS materials,
            COUNT(DISTINCT i.business) AS shops,
            AVG(CASE WHEN i.ingredient = 0 THEN i.price END) AS avgPrice
       FROM inventory i
       JOIN companies c ON c.business = i.business AND c.realm_id = i.realm_id
      WHERE i.realm_id = ? AND lower(c.hold) = ?
      GROUP BY i.item ORDER BY forSale DESC, i.item COLLATE NOCASE`)
    .bind(realmId, key(hold)).all();
  return (results || []).map((r) => ({
    item: r.item,
    forSale: Number(r.forSale) || 0,
    materials: Number(r.materials) || 0,
    shops: Number(r.shops) || 0,
    avgPrice: r.avgPrice == null ? null : money2(r.avgPrice),
  }));
}
