/**
 * Market Analysis (admin) — network-wide read-only analytics over the D1
 * transactional store. Aggregation happens in SQL so the Worker ships small
 * summaries, never raw rows.
 *
 * EXCLUDED from every figure here: voided sales, and EMPLOYEE PURCHASES — stock
 * a shop let a member of staff take without charge. The goods moved, so the
 * sale is in the history, but it is not trade: counting it would drag the
 * item's average price toward zero and make the shop look like it was giving
 * stock away.
 *
 * Sections:
 *   • businesses  — performance per shop (orders / items / revenue).
 *   • holds       — the same broken down by Skyrim hold.
 *   • underpriced — items selling BELOW their average purchase cost (a money-
 *                   losing anomaly worth flagging).
 */
import { getDb } from './db.js';
import { parseSaleItems } from './sales.js';
import { listItemIndex, matchMasterItem, normalizeItem } from './item-index.js';
import { readSettings } from './settings.js';

function settingVal(settings, label, dflt) {
  const s = (settings || []).find((x) => x.label === label);
  return s && isFinite(Number(s.value)) ? Number(s.value) : dflt;
}

/**
 * The quantity-weighted value at a quantile of a price distribution.
 *
 * Weighted, because a sale of twenty is twenty pieces of evidence about the
 * price and a sale of one is one. `prices` must be sorted ascending.
 */
function weightedQuantile(prices, q) {
  const total = prices.reduce((n, p) => n + p.qty, 0);
  if (!total) return null;
  const target = total * q;
  let seen = 0;
  for (const p of prices) {
    seen += p.qty;
    if (seen >= target) return p.price;
  }
  return prices[prices.length - 1].price;
}

/**
 * What the market values an item at, from EVERY transaction in it.
 *
 * Both directions count: what customers paid for it, what shops paid to stock
 * it, and what companies paid each other for it in transfers. They are all
 * prices the item actually changed hands at, which is the only evidence there
 * is of what it is worth.
 *
 * A mean over those would not do. One collector paying 5,000 for a sword that
 * normally moves at 30 drags the mean far above any price the item has ever
 * repeatedly fetched, and a single mispriced deal at 1 drags it under. A realm's
 * trade is exactly where those happen. So this does what a valuation does with
 * observed transactions:
 *
 *   1. Build the distribution of prices the item changed hands at, each
 *      weighted by how many units went at that price.
 *   2. Fence off outliers with the interquartile rule (Q1 − 1.5·IQR to
 *      Q3 + 1.5·IQR), the standard test for "this is not from the same
 *      population as the rest".
 *   3. Take the weighted MEDIAN of what survives — the price the middle unit
 *      changed hands at, which is what "worth about this much" means.
 *
 * Fencing needs a spread to measure, so it is skipped below four distinct
 * prices: with two or three deals an "outlier" is just as likely to be the real
 * price, and throwing it away would be inventing confidence.
 */
function transactionValue(lines) {
  if (!lines.length) return null;
  const byPrice = new Map();
  lines.forEach((l) => byPrice.set(l.price, (byPrice.get(l.price) || 0) + l.qty));
  let prices = [...byPrice.entries()].map(([price, qty]) => ({ price, qty }))
    .sort((a, b) => a.price - b.price);

  if (prices.length >= 4) {
    const q1 = weightedQuantile(prices, 0.25);
    const q3 = weightedQuantile(prices, 0.75);
    const iqr = q3 - q1;
    const lo = q1 - 1.5 * iqr;
    const hi = q3 + 1.5 * iqr;
    const kept = prices.filter((p) => p.price >= lo && p.price <= hi);
    if (kept.length) prices = kept;
  }
  return weightedQuantile(prices, 0.5);
}

/** Trend points, oldest → newest, capped to the most recent `days` with sales. */
const TREND_DAYS = 30;
function trendOf(dayMap) {
  return [...dayMap.entries()]
    .map(([day, v]) => ({ day, qty: v.qty, revenue: v.revenue, orders: v.orders }))
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .slice(-TREND_DAYS);
}

/**
 * Where the item is worth most: the region with the highest AVERAGE VALUE,
 * measured exactly as the realm-wide valuation is (see transactionValue) so the two
 * figures are comparable — "best" here means the item fetches more there, not
 * that more of it moves there.
 *
 * Volume breaks a tie, because between two regions paying the same the busier
 * one is the better market.
 */
function bestRegionOf(regionMap) {
  let best = null;
  regionMap.forEach((v, name) => {
    const value = transactionValue(v.lines);
    if (value == null) return;
    if (!best || value > best.value || (value === best.value && v.qty > best.qty)) {
      best = { region: name, value, qty: v.qty, revenue: v.revenue };
    }
  });
  return best;
}

/**
 * Aggregates per-item activity, but ONLY for items in the master index
 * (new/off-index items are kept out of the market so the data stays clean).
 * Names are canonicalized to their master spelling.
 *
 * What comes out:
 *
 *   • avgValue  — what the item is WORTH, from EVERY transaction in it: sales
 *                 to customers, intake bought from vendors, and transfers
 *                 bought from other companies. See transactionValue.
 *   • valueSamples — units of trade behind avgValue, both directions, so a
 *                 valuation resting on two changes of hands reads as the guess
 *                 it is.
 *   • bestRegion — where the item is worth most, over the trade recorded in
 *                 each region: sales rung up there, and intake sourced from
 *                 there, which is somebody there selling.
 *   • trend      — its daily series of units sold, for the graph.
 *
 * `revenue` stays on the row: it is the ranking key here, and the shop and
 * region reports display it.
 */
function itemStats(saleRows, master, intakeRows, transferRows) {
  const exact = new Map();
  master.forEach((it) => exact.set(normalizeItem(it.name), it));
  const map = {};
  const canon = (name) => exact.get(normalizeItem(name)) || matchMasterItem(name, master);
  const row = (key) => map[key] || (map[key] = {
    item: key, qty: 0, revenue: 0, orders: 0, boughtQty: 0, boughtValue: 0,
    lines: [], days: new Map(), regions: new Map(),
  });

  (saleRows || []).forEach((r) => {
    // One pass builds the totals, the daily series and the regional split
    // together: re-reading and re-parsing every sale three times to get them
    // separately is the expensive part of this whole module.
    const day = String(r.ts || '').slice(0, 10);
    const region = String(r.hold || '').trim();
    parseSaleItems(r.items).lines.forEach((l) => {
      const hit = canon(l.name);
      if (!hit) return; // not in the master index → excluded from market
      const m = row(hit.name);
      const value = l.qty * l.price;
      m.qty += l.qty;
      m.revenue += value;
      m.orders += 1;
      m.lines.push({ price: l.price, qty: l.qty });
      if (day) {
        const d = m.days.get(day) || { qty: 0, revenue: 0, orders: 0 };
        d.qty += l.qty; d.revenue += value; d.orders += 1;
        m.days.set(day, d);
      }
      if (region) {
        // The price lines are kept per region as well as overall, so a region's
        // value is the same kind of figure as the realm's — a weighted median
        // with outliers fenced, not a mean that one sale can define.
        const g = m.regions.get(region) || { qty: 0, revenue: 0, lines: [] };
        g.qty += l.qty; g.revenue += value; g.lines.push({ price: l.price, qty: l.qty });
        m.regions.set(region, g);
      }
    });
  });

  // The BUY side: every way a company takes stock in and pays for it.
  const bought = (name, qty, per, region) => {
    const hit = canon(name);
    // A price of 0 is a gift, not a transaction at a price, and averaging it in
    // would drag the item's value toward nothing — the same reason an employee
    // purchase is not a sale.
    if (!hit || !(qty > 0) || !(per > 0)) return;
    const m = row(hit.name);
    m.boughtQty += qty;
    m.boughtValue += qty * per;
    // A buy is a transaction too, so it is evidence of what the item is worth.
    m.lines.push({ price: per, qty });
    // And it counts as trade in the region the goods CAME FROM: someone there
    // sold them. Intake records that region; a sale records where it was rung
    // up. Both are the item changing hands in that place.
    if (region) {
      const g = m.regions.get(region) || { qty: 0, revenue: 0, lines: [] };
      g.qty += qty; g.revenue += qty * per; g.lines.push({ price: per, qty });
      m.regions.set(region, g);
    }
  };
  // Intake: bought from a vendor outside the network, in a stated region.
  (intakeRows || []).forEach((r) =>
    bought(r.item, Number(r.num_items) || 0, Number(r.price_per) || 0, String(r.source_hold || '').trim()));
  // Accepted transfers: bought from another company INSIDE the network. The
  // goods arrived and were paid for at the transfer's price. No region: a
  // transfer records two companies, not a place.
  (transferRows || []).forEach((r) => bought(r.item, Number(r.qty) || 0, Number(r.price) || 0, ''));

  return Object.values(map).map((m) => {
    // The raw lines and the accumulator maps are working data, not payload.
    const { lines, days, regions, ...rest } = m;
    return {
      ...rest,
      avgValue: transactionValue(lines),
      // Units of real trade behind the valuation, both directions — a figure
      // from two changes of hands and one from two hundred read identically in
      // a table, and they should not.
      valueSamples: m.qty + m.boughtQty,
      bestRegion: bestRegionOf(regions),
      // withoutTrend() strips this for list responses: a 30-point series per
      // item would dwarf everything else in them.
      trend: trendOf(days),
    };
  }).sort((a, b) => b.revenue - a.revenue);
}

/**
 * Folds the two sides of a region's trade together, keyed by region name.
 * `hold` is kept as the field name because every caller and view already reads
 * it — see the naming note in CLAUDE.md.
 */
function mergeRegionTrade(...groups) {
  const byRegion = new Map();
  groups.forEach((rows) => (rows || []).forEach((r) => {
    const name = String(r.region || '').trim();
    if (!name) return;
    const cur = byRegion.get(name) || { hold: name, orders: 0, items: 0, revenue: 0 };
    cur.orders += Number(r.orders) || 0;
    cur.items += Number(r.items) || 0;
    cur.revenue += Number(r.revenue) || 0;
    byRegion.set(name, cur);
  }));
  return [...byRegion.values()].sort((a, b) => b.revenue - a.revenue);
}

/** The list shape: everything except the per-item series. */
function withoutTrend(rows) {
  return rows.map(({ trend, ...rest }) => rest);
}

export async function marketAnalysis(env, realmId) {
  const db = await getDb(env);

  // No network-totals block: Overview stopped showing headline tiles, and a
  // summary nothing renders is a query run on every load for nobody. The shop
  // and region reports keep their own overviews — those ARE displayed.
  const businesses = ((await db.prepare(
    `SELECT business,
            COUNT(*) AS orders,
            COALESCE(SUM(qty_total), 0) AS items,
            COALESCE(SUM(total), 0) AS revenue
       FROM sales
      WHERE realm_id = ? AND status != 'VOIDED' AND staff_purchase = 0
      GROUP BY business
      ORDER BY revenue DESC
      LIMIT 200`).bind(realmId).all()).results) || [];

  /**
   * A region's trade is everything that changed hands THERE — sales rung up in
   * it, and intake sourced from it, which is somebody in that region selling to
   * a shop. Counting only the register's side would credit a region for what it
   * buys and nothing for what it supplies.
   */
  const holds = mergeRegionTrade(
    ((await db.prepare(
      `SELECT hold AS region,
              COUNT(*) AS orders,
              COALESCE(SUM(qty_total), 0) AS items,
              COALESCE(SUM(total), 0) AS revenue
         FROM sales
        WHERE realm_id = ? AND status != 'VOIDED' AND staff_purchase = 0 AND hold IS NOT NULL AND hold != ''
        GROUP BY hold`).bind(realmId).all()).results) || [],
    ((await db.prepare(
      `SELECT source_hold AS region,
              COUNT(*) AS orders,
              COALESCE(SUM(num_items), 0) AS items,
              COALESCE(SUM(num_items * price_per), 0) AS revenue
         FROM intake
        WHERE realm_id = ? AND source_hold IS NOT NULL AND source_hold != ''
        GROUP BY source_hold`).bind(realmId).all()).results) || []);

  const underpriced = ((await db.prepare(
    `SELECT i.business AS business, i.item AS item,
            i.price AS salePrice, AVG(k.price_per) AS avgCost
       FROM inventory i
       JOIN intake k ON k.business = i.business AND k.item = i.item AND k.realm_id = i.realm_id
      WHERE i.realm_id = ?
      GROUP BY i.business, i.item
     HAVING i.price < AVG(k.price_per)
      ORDER BY (AVG(k.price_per) - i.price) DESC
      LIMIT 50`).bind(realmId).all()).results) || [];

  // NOTE: low stock is deliberately NOT part of network analysis — it's a
  // per-shop operational concern, surfaced to owners as the Restock report
  // (inventory.lowStockReport / GET /business/low-stock).

  const master = await listItemIndex(env, realmId);
  // ts and hold come along so one pass can build the per-item daily series and
  // regional split as well as the totals.
  const saleRows = ((await db.prepare(
    `SELECT ts, hold, items FROM sales WHERE realm_id = ? AND status != 'VOIDED' AND staff_purchase = 0`).bind(realmId).all()).results) || [];
  // Intake is the buy side of the same items — what a shop paid to stock them.
  const intakeRows = ((await db.prepare(
    `SELECT item, num_items, price_per, source_hold FROM intake WHERE realm_id = ?`).bind(realmId).all()).results) || [];
  const transferRows = ((await db.prepare(
    `SELECT item, qty, price FROM transfers WHERE realm_id = ? AND status = 'accepted'`).bind(realmId).all()).results) || [];
  const ranked = itemStats(saleRows, master, intakeRows, transferRows);
  // Only the five on screen carry a trend; the rest of the list would multiply
  // the response size for series nothing draws.
  const items = withoutTrend(ranked);
  const topItems = ranked.slice(0, TOP_ITEMS);

  /**
   * Pricing anomalies, measured against what the item is actually WORTH.
   *
   * The comparison used to be the master index's base value — a figure an admin
   * typed in, which the settings already called an "item average" without being
   * one. It now uses avgValue: the weighted median of what the item really sold
   * hands at, outliers fenced (see transactionValue). A shop charging double what the realm
   * pays is the thing worth flagging, and only observed trade can say what that
   * is.
   *
   * An item with no sales yet is SKIPPED rather than falling back to the base
   * value. Nothing has been observed, so there is no claim to make — and a list
   * mixing "twice what it sells for" with "twice what someone guessed" would
   * mean neither.
   */
  const settings = await readSettings(env, realmId);
  const overX = settingVal(settings, 'Overpricing threshold (x item average)', 1.5);
  const underX = settingVal(settings, 'Undercutting threshold (x item average)', 0.5);
  const valueByNorm = new Map();
  ranked.forEach((r) => { if (r.avgValue > 0) valueByNorm.set(normalizeItem(r.item), r); });
  // Ingredients are excluded: they are held to craft with, not sold, so their
  // listed price is not an offer to anybody.
  const invRows = ((await db.prepare('SELECT business, item, price FROM inventory WHERE realm_id = ? AND ingredient = 0').bind(realmId).all()).results) || [];
  const overpriced = [];
  const undercut = [];
  invRows.forEach((r) => {
    const m = valueByNorm.get(normalizeItem(r.item));
    if (!m) return; // never sold in this realm — nothing observed to judge against
    const ratio = r.price / m.avgValue;
    const row = { business: r.business, item: m.item, price: r.price, value: m.avgValue, samples: m.valueSamples, ratio };
    if (ratio >= overX) overpriced.push(row);
    else if (ratio <= underX) undercut.push(row);
  });
  overpriced.sort((a, b) => b.ratio - a.ratio);
  undercut.sort((a, b) => a.ratio - b.ratio);

  // Daily revenue trend (last 30 days with activity), oldest → newest.
  const trends = (((await db.prepare(
    `SELECT substr(ts, 1, 10) AS day, COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders
       FROM sales WHERE realm_id = ? AND status != 'VOIDED' AND staff_purchase = 0
      GROUP BY day ORDER BY day DESC LIMIT 30`).bind(realmId).all()).results) || []).reverse();

  return {
    businesses, holds, items, topItems, underpriced,
    overpriced: overpriced.slice(0, 50), undercut: undercut.slice(0, 50),
    thresholds: { over: overX, under: underX }, trends,
  };
}

/** How many items Item Performance leads with. */
export const TOP_ITEMS = 5;

/**
 * One item, in full — the same figures the top five show, plus its trend.
 *
 * Backs the search box: the list response deliberately omits per-item series,
 * so looking one up fetches it on demand rather than shipping every item's
 * series to everyone on the chance one is opened.
 *
 * Filtering happens in JS rather than SQL because a sale's items are a JSON
 * blob in one column — there is nothing to put in a WHERE clause. The read is
 * the same one the whole page already does.
 */
export async function itemReport(env, name, realmId) {
  const wanted = String(name || '').trim();
  if (!wanted) throw new Error('Which item?');
  const db = await getDb(env);
  const master = await listItemIndex(env, realmId);
  const hit = master.find((m) => normalizeItem(m.name) === normalizeItem(wanted));
  if (!hit) throw new Error('No item called "' + wanted + '" in this realm\'s index.');

  const saleRows = ((await db.prepare(
    `SELECT ts, hold, items FROM sales WHERE realm_id = ? AND status != 'VOIDED' AND staff_purchase = 0`).bind(realmId).all()).results) || [];
  const intakeRows = ((await db.prepare(
    `SELECT item, num_items, price_per, source_hold FROM intake WHERE realm_id = ?`).bind(realmId).all()).results) || [];
  const transferRows = ((await db.prepare(
    `SELECT item, qty, price FROM transfers WHERE realm_id = ? AND status = 'accepted'`).bind(realmId).all()).results) || [];
  const found = itemStats(saleRows, master, intakeRows, transferRows).find((r) => r.item === hit.name);

  // An indexed item that has never traded is a valid answer, not an error.
  return {
    item: found || {
      item: hit.name, qty: 0, revenue: 0, orders: 0, boughtQty: 0, boughtValue: 0,
      avgValue: null, valueSamples: 0,
      bestRegion: null, trend: [],
    },
    baseValue: hit.baseValue,
    category: hit.category,
  };
}

/**
 * One shop's own performance — the owner-facing counterpart to the network
 * market view. Scoped strictly to the caller's business: headline totals, a
 * daily revenue trend, and their best-selling items.
 */
export async function businessReport(env, business, realmId) {
  const db = await getDb(env);
  const b = String(business || '').trim();
  const empty = { business: b, overview: { revenue: 0, orders: 0, itemsSold: 0 }, trends: [], items: [] };
  if (!b) return empty;

  const overview = await db.prepare(
    `SELECT COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders,
            COALESCE(SUM(qty_total), 0) AS itemsSold
       FROM sales WHERE realm_id = ? AND status != 'VOIDED' AND staff_purchase = 0 AND business = ?`).bind(realmId, b).first();

  const trends = (((await db.prepare(
    `SELECT substr(ts, 1, 10) AS day, COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders
       FROM sales WHERE realm_id = ? AND status != 'VOIDED' AND staff_purchase = 0 AND business = ?
      GROUP BY day ORDER BY day DESC LIMIT 30`).bind(realmId, b).all()).results) || []).reverse();

  const saleRows = ((await db.prepare(
    `SELECT items FROM sales WHERE realm_id = ? AND status != 'VOIDED' AND staff_purchase = 0 AND business = ?`).bind(realmId, b).all()).results) || [];
  const intakeRows = ((await db.prepare(
    `SELECT item, num_items, price_per, source_hold FROM intake WHERE realm_id = ? AND business = ?`).bind(realmId, b).all()).results) || [];
  // What this shop took IN from other companies counts as its buying too.
  const transferRows = ((await db.prepare(
    `SELECT item, qty, price FROM transfers WHERE realm_id = ? AND status = 'accepted' AND to_business = ?`)
    .bind(realmId, b).all()).results) || [];

  return {
    business: b,
    overview: overview || empty.overview,
    trends,
    items: withoutTrend(itemStats(saleRows, await listItemIndex(env, realmId), intakeRows, transferRows)).slice(0, 20),
  };
}

/**
 * A single hold's report — the slice a Court oversees. Scoped to sales made in
 * that hold: overview, the shops trading there, and the items moving there.
 */
export async function holdReport(env, hold, realmId) {
  const db = await getDb(env);
  const h = String(hold || '').trim();
  if (!h) return { hold: '', overview: { revenue: 0, orders: 0, itemsSold: 0, activeShops: 0 }, businesses: [], items: [] };

  // Sales rung up here, plus what shops bought FROM here — both are trade in
  // this region, and a Court judging its own economy needs both.
  const sold = await db.prepare(
    `SELECT COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders,
            COALESCE(SUM(qty_total), 0) AS itemsSold, COUNT(DISTINCT business) AS activeShops
       FROM sales WHERE realm_id = ? AND status != 'VOIDED' AND staff_purchase = 0 AND hold = ?`).bind(realmId, h).first();
  const supplied = await db.prepare(
    `SELECT COALESCE(SUM(num_items * price_per), 0) AS revenue, COUNT(*) AS orders,
            COALESCE(SUM(num_items), 0) AS itemsSold
       FROM intake WHERE realm_id = ? AND source_hold = ?`).bind(realmId, h).first();
  const overview = {
    revenue: (sold ? sold.revenue : 0) + (supplied ? supplied.revenue : 0),
    orders: (sold ? sold.orders : 0) + (supplied ? supplied.orders : 0),
    itemsSold: (sold ? sold.itemsSold : 0) + (supplied ? supplied.itemsSold : 0),
    // Shops TRADING here. Intake names a vendor, not a registered company, so
    // the supply side has nobody to count.
    activeShops: sold ? sold.activeShops : 0,
  };

  const businesses = ((await db.prepare(
    `SELECT business, COUNT(*) AS orders,
            COALESCE(SUM(qty_total), 0) AS items, COALESCE(SUM(total), 0) AS revenue
       FROM sales WHERE realm_id = ? AND status != 'VOIDED' AND staff_purchase = 0 AND hold = ?
      GROUP BY business ORDER BY revenue DESC LIMIT 200`).bind(realmId, h).all()).results) || [];

  const saleRows = ((await db.prepare(
    `SELECT items FROM sales WHERE realm_id = ? AND status != 'VOIDED' AND staff_purchase = 0 AND hold = ?`).bind(realmId, h).all()).results) || [];
  const intakeRows = ((await db.prepare(
    `SELECT item, num_items, price_per, source_hold FROM intake WHERE realm_id = ? AND source_hold = ?`)
    .bind(realmId, h).all()).results) || [];

  return { hold: h, overview, businesses,
    items: withoutTrend(itemStats(saleRows, await listItemIndex(env, realmId), intakeRows)) };
}
