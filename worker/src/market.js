/**
 * Market Analysis (admin) — network-wide read-only analytics over the D1
 * transactional store. Aggregation happens in SQL so the Worker ships small
 * summaries, never raw rows. Voided sales are excluded from revenue/volume.
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
 * What the market actually values an item at, from its SALES.
 *
 * The mean sale price is not that number. One collector paying 5,000 for a
 * sword that normally moves at 30 drags the mean far above any price the item
 * has ever repeatedly fetched, and a single mispriced sale at 1 drags it under.
 * A realm's trade is exactly where those happen.
 *
 * So this does what a valuation normally does with observed transactions:
 *
 *   1. Build the distribution of prices the item SOLD at, each weighted by how
 *      many units went at that price.
 *   2. Fence off outliers with the interquartile rule (Q1 − 1.5·IQR to
 *      Q3 + 1.5·IQR), the standard test for "this is not from the same
 *      population as the rest".
 *   3. Take the weighted MEDIAN of what survives — the price the middle unit
 *      sold at, which is what "worth about this much" means.
 *
 * Fencing needs a spread to measure, so it is skipped below four distinct
 * prices: with two or three sales an "outlier" is just as likely to be the real
 * price, and throwing it away would be inventing confidence.
 *
 * Intake is deliberately NOT part of this. What a shop paid a supplier is its
 * cost, not the item's value — mixing the two produces a number that is neither.
 * It stays available on its own as avgBought.
 */
function salesValue(lines) {
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

/**
 * Aggregates per-item activity, but ONLY for items in the master index
 * (new/off-index items are kept out of the market so the data stays clean).
 * Names are canonicalized to their master spelling.
 *
 * Both SIDES of the trade are reported, plus a valuation:
 *
 *   • avgSold   — quantity-weighted MEAN of what it went for. "On average we
 *                 charged this", takings divided by units.
 *   • avgBought — the same for intake: what it costs to stock.
 *   • avgValue  — what the item is WORTH, from a sales analysis (see
 *                 salesValue). Robust to the one absurd sale that a mean is not.
 *   • valueSamples — units of sales behind avgValue, so a valuation resting on
 *                 two units can be read as the guess it is.
 *
 * `revenue` stays on the row: it is the ranking key here, and the shop and
 * region reports display it.
 */
function itemStats(saleRows, master, intakeRows) {
  const exact = new Map();
  master.forEach((it) => exact.set(normalizeItem(it.name), it));
  const map = {};
  const canon = (name) => exact.get(normalizeItem(name)) || matchMasterItem(name, master);
  const row = (key) => map[key] || (map[key] = {
    item: key, qty: 0, revenue: 0, orders: 0, boughtQty: 0, boughtValue: 0, lines: [],
  });

  (saleRows || []).forEach((r) => {
    parseSaleItems(r.items).lines.forEach((l) => {
      const hit = canon(l.name);
      if (!hit) return; // not in the master index → excluded from market
      const m = row(hit.name);
      m.qty += l.qty;
      m.revenue += l.qty * l.price;
      m.orders += 1;
      m.lines.push({ price: l.price, qty: l.qty });
    });
  });

  (intakeRows || []).forEach((r) => {
    const hit = canon(r.item);
    if (!hit) return;
    const qty = Number(r.num_items) || 0;
    const per = Number(r.price_per) || 0;
    if (qty <= 0) return;
    const m = row(hit.name);
    m.boughtQty += qty;
    m.boughtValue += qty * per;
  });

  return Object.values(map).map((m) => {
    const { lines, ...rest } = m; // the raw lines are working data, not payload
    return {
      ...rest,
      avgSold: m.qty > 0 ? m.revenue / m.qty : null,
      avgBought: m.boughtQty > 0 ? m.boughtValue / m.boughtQty : null,
      avgValue: salesValue(lines),
      valueSamples: m.qty,
    };
  }).sort((a, b) => b.revenue - a.revenue);
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
      WHERE realm_id = ? AND status != 'VOIDED'
      GROUP BY business
      ORDER BY revenue DESC
      LIMIT 200`).bind(realmId).all()).results) || [];

  const holds = ((await db.prepare(
    `SELECT hold,
            COUNT(*) AS orders,
            COALESCE(SUM(qty_total), 0) AS items,
            COALESCE(SUM(total), 0) AS revenue
       FROM sales
      WHERE realm_id = ? AND status != 'VOIDED' AND hold IS NOT NULL AND hold != ''
      GROUP BY hold
      ORDER BY revenue DESC`).bind(realmId).all()).results) || [];

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
  const saleRows = ((await db.prepare(
    `SELECT items FROM sales WHERE realm_id = ? AND status != 'VOIDED'`).bind(realmId).all()).results) || [];
  // Intake is the buy side of the same items — what a shop paid to stock them.
  const intakeRows = ((await db.prepare(
    `SELECT item, num_items, price_per FROM intake WHERE realm_id = ?`).bind(realmId).all()).results) || [];
  const items = itemStats(saleRows, master, intakeRows);

  // Pricing anomalies vs the master base values, using the network thresholds.
  const settings = await readSettings(env, realmId);
  const overX = settingVal(settings, 'Overpricing threshold (x item average)', 1.5);
  const underX = settingVal(settings, 'Undercutting threshold (x item average)', 0.5);
  const masterByNorm = new Map(master.map((m) => [normalizeItem(m.name), m]));
  const invRows = ((await db.prepare('SELECT business, item, price FROM inventory WHERE realm_id = ?').bind(realmId).all()).results) || [];
  const overpriced = [];
  const undercut = [];
  invRows.forEach((r) => {
    const m = masterByNorm.get(normalizeItem(r.item));
    if (!m || !(m.baseValue > 0)) return; // only items with a real base value
    const ratio = r.price / m.baseValue;
    if (ratio >= overX) overpriced.push({ business: r.business, item: m.name, price: r.price, baseValue: m.baseValue, ratio });
    else if (ratio <= underX) undercut.push({ business: r.business, item: m.name, price: r.price, baseValue: m.baseValue, ratio });
  });
  overpriced.sort((a, b) => b.ratio - a.ratio);
  undercut.sort((a, b) => a.ratio - b.ratio);

  // Daily revenue trend (last 30 days with activity), oldest → newest.
  const trends = (((await db.prepare(
    `SELECT substr(ts, 1, 10) AS day, COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders
       FROM sales WHERE realm_id = ? AND status != 'VOIDED'
      GROUP BY day ORDER BY day DESC LIMIT 30`).bind(realmId).all()).results) || []).reverse();

  return {
    businesses, holds, items, underpriced,
    overpriced: overpriced.slice(0, 50), undercut: undercut.slice(0, 50),
    thresholds: { over: overX, under: underX }, trends,
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
       FROM sales WHERE realm_id = ? AND status != 'VOIDED' AND business = ?`).bind(realmId, b).first();

  const trends = (((await db.prepare(
    `SELECT substr(ts, 1, 10) AS day, COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders
       FROM sales WHERE realm_id = ? AND status != 'VOIDED' AND business = ?
      GROUP BY day ORDER BY day DESC LIMIT 30`).bind(realmId, b).all()).results) || []).reverse();

  const saleRows = ((await db.prepare(
    `SELECT items FROM sales WHERE realm_id = ? AND status != 'VOIDED' AND business = ?`).bind(realmId, b).all()).results) || [];
  const intakeRows = ((await db.prepare(
    `SELECT item, num_items, price_per FROM intake WHERE realm_id = ? AND business = ?`).bind(realmId, b).all()).results) || [];

  return {
    business: b,
    overview: overview || empty.overview,
    trends,
    items: itemStats(saleRows, await listItemIndex(env, realmId), intakeRows).slice(0, 20),
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

  const overview = await db.prepare(
    `SELECT COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders,
            COALESCE(SUM(qty_total), 0) AS itemsSold, COUNT(DISTINCT business) AS activeShops
       FROM sales WHERE realm_id = ? AND status != 'VOIDED' AND hold = ?`).bind(realmId, h).first();

  const businesses = ((await db.prepare(
    `SELECT business, COUNT(*) AS orders,
            COALESCE(SUM(qty_total), 0) AS items, COALESCE(SUM(total), 0) AS revenue
       FROM sales WHERE realm_id = ? AND status != 'VOIDED' AND hold = ?
      GROUP BY business ORDER BY revenue DESC LIMIT 200`).bind(realmId, h).all()).results) || [];

  const saleRows = ((await db.prepare(
    `SELECT items FROM sales WHERE realm_id = ? AND status != 'VOIDED' AND hold = ?`).bind(realmId, h).all()).results) || [];

  // No intake side here: a region's report covers sales MADE in that region, and
  // intake records where goods came FROM, which is a different question.
  return { hold: h, overview: overview || { revenue: 0, orders: 0, itemsSold: 0, activeShops: 0 }, businesses, items: itemStats(saleRows, await listItemIndex(env, realmId)) };
}
