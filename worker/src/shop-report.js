/**
 * A SHOP'S OWN PERFORMANCE — the owner-facing report.
 *
 * Its own module rather than another section of market.js: that one values the
 * realm's ITEMS for everybody, this one answers "how is my shop doing" for one
 * owner. They meet at exactly one place — `itemStats`, which is what a shop's
 * best-seller list is — and nowhere else.
 *
 * TWO CLOCKS, and the report says which is which. The headline figures are ALL
 * TIME, because that is what the question means to somebody who has run the
 * place for a month. Everything that only makes sense against a clock — is it
 * growing, what did the month cost, which day is worth opening for — is worked
 * out over the LAST 30 DAYS and compared with the 30 before. Mixing the two
 * silently is how a report ends up quoting a year's takings against a week's
 * costs.
 *
 * Almost all of it comes out of ONE pass over the shop's sales, read once and
 * walked in JS rather than asked for again per figure. The exceptions are the
 * coffer (money that actually moved, so this page cannot disagree with the
 * ledger) and the inventory (what is on the shelf, which sales cannot know).
 */
import { getDb } from './db.js';
import { parseSaleItems } from './sales.js';
import { listItemIndex } from './item-index.js';
import { itemStats, withoutTrend, NOT_HARVEST } from './market.js';

const DAY = 86400000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * ONE WALK over every countable sale, producing everything that can be counted
 * from one.
 *
 * Separately these are five loops over the same rows, and the parse is the
 * expensive part of each — the lines have to be read to know what moved, so
 * everything that depends on knowing is worked out while they are open.
 */
function salePass(saleRows, since, before) {
  const customers = new Map();   // name → how many orders
  const byWeekday = new Map();   // weekday → revenue, in the window
  const activeDays = new Set();  // days with a sale, in the window
  const lastSold = new Map();    // lowered item → the day it last moved
  const unitsByItem = new Map(); // lowered item → units, in the window
  let given = 0;                 // what order-level adjustments took off
  const recent = { revenue: 0, orders: 0, itemsSold: 0 };
  const prior = { revenue: 0, orders: 0 };

  for (const r of saleRows) {
    const ts = String(r.ts || '');
    const day = ts.slice(0, 10);
    const inWindow = ts >= since;
    const total = Number(r.total) || 0;

    const who = String(r.customer || '').trim();
    if (who) customers.set(who.toLowerCase(), (customers.get(who.toLowerCase()) || 0) + 1);

    if (inWindow) {
      recent.revenue += total;
      recent.orders += 1;
      if (day) activeDays.add(day);
      const wd = WEEKDAYS[new Date(ts).getDay()];
      if (wd) byWeekday.set(wd, (byWeekday.get(wd) || 0) + total);
    } else if (ts >= before) {
      prior.revenue += total;
      prior.orders += 1;
    }

    let gross = 0;
    for (const l of parseSaleItems(r.items).lines) {
      gross += l.qty * l.price;
      // A special is one line to the customer and several to the stockroom, so
      // what MOVED is its parts. Its money has no per-item split and none is
      // invented here — this counts units, never value.
      const moved = (l.parts && l.parts.length)
        ? l.parts.map((p) => ({ item: p.item, qty: p.qty * l.qty }))
        : [{ item: l.name, qty: l.qty }];
      for (const m of moved) {
        const key = String(m.item || '').trim().toLowerCase();
        if (!key) continue;
        if (day && (!lastSold.has(key) || lastSold.get(key) < day)) lastSold.set(key, day);
        if (inWindow) {
          recent.itemsSold += m.qty;
          unitsByItem.set(key, (unitsByItem.get(key) || 0) + m.qty);
        }
      }
    }
    // Positive means money came off the order. A shop that only ever charges
    // list price scores 0, and an upcharge shows as a negative rather than as a
    // second figure nobody was looking for.
    given += gross - total;
  }
  return { customers, byWeekday, activeDays, lastSold, unitsByItem, given, recent, prior };
}

/**
 * WHAT IS ON THE SHELF, and what is sitting on it.
 *
 * `slow` is the figure a best-seller list cannot show you and the one actually
 * costing the shop money: stock held, worth something, and not sold in sixty
 * days. Ranked by what is tied up in it.
 */
function shelfStats(invRows, lastSold, stale) {
  const sellable = invRows.filter((r) => !Number(r.ingredient));
  const held = (r) => Number(r.stock) || 0;
  const stock = {
    listings: sellable.length,
    units: sellable.reduce((n, r) => n + held(r), 0),
    value: sellable.reduce((n, r) => n + held(r) * (Number(r.price) || 0), 0),
    low: sellable.filter((r) => held(r) > 0 && Number(r.low_stock) > 0 && held(r) <= Number(r.low_stock)).length,
    out: sellable.filter((r) => !held(r)).length,
    ingredients: invRows.length - sellable.length,
  };
  const slow = sellable
    .filter((r) => held(r) > 0)
    .map((r) => ({
      item: r.item,
      stock: held(r),
      value: held(r) * (Number(r.price) || 0),
      lastSold: lastSold.get(String(r.item).toLowerCase()) || '',
    }))
    .filter((r) => !r.lastSold || r.lastSold < stale)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  return { stock, slow };
}

/**
 * UNITS BY KIND — what sort of thing this shop actually shifts.
 *
 * Units and not money: a special's line has one price for several things, and
 * splitting it per item would invent the very figure the bundle rule exists to
 * avoid. An item tagged twice counts under both, which is right — the question
 * is "how much food moved", not "how do my takings divide up".
 */
function kindUnits(invRows, unitsByItem) {
  const kinds = new Map();
  for (const r of invRows) {
    const units = unitsByItem.get(String(r.item).toLowerCase()) || 0;
    if (!units) continue;
    for (const tag of String(r.tags || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)) {
      kinds.set(tag, (kinds.get(tag) || 0) + units);
    }
  }
  return [...kinds.entries()].map(([tag, qty]) => ({ tag, qty })).sort((a, b) => b.qty - a.qty);
}

export async function businessReport(env, business, realmId) {
  const db = await getDb(env);
  const b = String(business || '').trim();
  const empty = {
    business: b, overview: { revenue: 0, orders: 0, itemsSold: 0 },
    trends: [], items: [], period: null, stock: null, kinds: [], slow: [],
  };
  if (!b) return empty;

  const now = Date.now();
  const since = new Date(now - 30 * DAY).toISOString();
  const before = new Date(now - 60 * DAY).toISOString();
  const stale = new Date(now - 60 * DAY).toISOString().slice(0, 10);
  const forShop = (sql) => db.prepare(sql).bind(realmId, b);

  const overview = await forShop(
    `SELECT COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders,
            COALESCE(SUM(qty_total), 0) AS itemsSold
       FROM sales WHERE realm_id = ? AND status != 'VOIDED' AND staff_purchase = 0 AND business = ?`).first();
  const trends = (((await forShop(
    `SELECT substr(ts, 1, 10) AS day, COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders
       FROM sales WHERE realm_id = ? AND status != 'VOIDED' AND staff_purchase = 0 AND business = ?
      GROUP BY day ORDER BY day DESC LIMIT 30`).all()).results) || []).reverse();
  // Every countable sale, ONCE. ts/customer/total ride along so the customer
  // count, the weekday split and what discounts gave away all come out of the
  // pass that already had to parse the lines.
  const saleRows = ((await forShop(
    `SELECT ts, customer, total, items FROM sales
      WHERE realm_id = ? AND status != 'VOIDED' AND staff_purchase = 0 AND business = ?`).all()).results) || [];
  const intakeRows = ((await forShop(
    `SELECT item, num_items, price_per, source_hold FROM intake WHERE realm_id = ? AND business = ?` + NOT_HARVEST).all()).results) || [];
  // What this shop took IN from other companies counts as its buying too.
  const transferRows = ((await db.prepare(
    `SELECT item, qty, price, items FROM transfers WHERE realm_id = ? AND status = 'accepted' AND to_business = ?`)
    .bind(realmId, b).all()).results) || [];
  const invRows = ((await forShop(
    `SELECT item, price, stock, low_stock, ingredient, tags FROM inventory WHERE realm_id = ? AND business = ?`).all()).results) || [];
  // The COFFER is money that actually moved. Taking "money out" from intake
  // instead would miss wages, the levy and every hand adjustment — and would
  // let this report disagree with the shop's own ledger, which is worse than
  // not reporting it at all.
  const cofferRows = ((await db.prepare(
    `SELECT amount FROM coffer_entries WHERE realm_id = ? AND business = ? AND ts >= ?`)
    .bind(realmId, b, since).all()).results) || [];
  const rejected = await forShop(
    `SELECT COUNT(*) AS voided FROM sales WHERE realm_id = ? AND business = ? AND status = 'VOIDED'`).first();
  const staffRows = await forShop(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(qty_total), 0) AS units FROM sales
      WHERE realm_id = ? AND business = ? AND status != 'VOIDED' AND staff_purchase = 1`).first();

  const pass = salePass(saleRows, since, before);
  const { stock, slow } = shelfStats(invRows, pass.lastSold, stale);
  const moneyIn = cofferRows.reduce((n, r) => n + Math.max(0, Number(r.amount) || 0), 0);
  const moneyOut = cofferRows.reduce((n, r) => n + Math.min(0, Number(r.amount) || 0), 0);
  const busiest = [...pass.byWeekday.entries()].sort((a, b2) => b2[1] - a[1])[0];
  const sums = overview || empty.overview;

  return {
    business: b,
    overview: {
      ...sums,
      // The two figures every other one is read against, worked out here so the
      // screen never has to divide by an orders count it might not have.
      avgOrder: sums.orders ? sums.revenue / sums.orders : 0,
      itemsPerOrder: sums.orders ? sums.itemsSold / sums.orders : 0,
      customers: pass.customers.size,
      repeat: [...pass.customers.values()].filter((n) => n > 1).length,
      discountGiven: pass.given,
      voided: (rejected && rejected.voided) || 0,
      staffOrders: (staffRows && staffRows.orders) || 0,
      staffUnits: (staffRows && staffRows.units) || 0,
    },
    period: {
      days: 30,
      revenue: pass.recent.revenue,
      orders: pass.recent.orders,
      itemsSold: pass.recent.itemsSold,
      avgOrder: pass.recent.orders ? pass.recent.revenue / pass.recent.orders : 0,
      activeDays: pass.activeDays.size,
      busiestDay: busiest ? busiest[0] : '',
      busiestRevenue: busiest ? busiest[1] : 0,
      moneyIn,
      // Negative in the coffer; reported as what it COST, since "outgoings
      // −780" reads as a double negative on a page of takings.
      moneyOut: -moneyOut,
      kept: moneyIn + moneyOut,
      prevRevenue: pass.prior.revenue,
      prevOrders: pass.prior.orders,
    },
    stock,
    slow,
    kinds: kindUnits(invRows, pass.unitsByItem),
    trends,
    items: withoutTrend(itemStats(saleRows, await listItemIndex(env, realmId), intakeRows, transferRows)).slice(0, 20),
  };
}
