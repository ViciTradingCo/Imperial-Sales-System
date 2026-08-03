/**
 * Market Analysis (admin) — network-wide read-only analytics over the D1
 * transactional store. Aggregation happens in SQL so the Worker ships small
 * summaries, never raw rows. Voided sales are excluded from revenue/volume.
 *
 * Sections:
 *   • overview    — totals across the whole network.
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
 * Aggregates per-item activity, but ONLY for items in the master index
 * (new/off-index items are kept out of the market so the data stays clean).
 * Names are canonicalized to their master spelling.
 *
 * Both SIDES of the trade are aggregated: what shops sold the item for, and
 * what they paid for it on intake. That gives three prices the register's base
 * value can't:
 *
 *   • avgSold   — quantity-weighted mean of what it actually went for.
 *   • avgBought — the same for intake, i.e. what it costs to stock.
 *   • avgValue  — both sides together, quantity-weighted. The item's observed
 *                 worth across the realm: not what an admin typed into the
 *                 index, but what the market has actually been paying. With
 *                 only one side recorded it IS that side's average, which is
 *                 the honest answer rather than a half-figure.
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
    item: key, qty: 0, revenue: 0, orders: 0, boughtQty: 0, boughtValue: 0,
  });

  (saleRows || []).forEach((r) => {
    parseSaleItems(r.items).lines.forEach((l) => {
      const hit = canon(l.name);
      if (!hit) return; // not in the master index → excluded from market
      const m = row(hit.name);
      m.qty += l.qty;
      m.revenue += l.qty * l.price;
      m.orders += 1;
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
    const totalQty = m.qty + m.boughtQty;
    return {
      ...m,
      avgSold: m.qty > 0 ? m.revenue / m.qty : null,
      avgBought: m.boughtQty > 0 ? m.boughtValue / m.boughtQty : null,
      avgValue: totalQty > 0 ? (m.revenue + m.boughtValue) / totalQty : null,
    };
  }).sort((a, b) => b.revenue - a.revenue);
}

export async function marketAnalysis(env, realmId) {
  const db = await getDb(env);

  const overview = await db.prepare(
    `SELECT COALESCE(SUM(total), 0) AS revenue,
            COUNT(*) AS orders,
            COALESCE(SUM(qty_total), 0) AS itemsSold,
            COUNT(DISTINCT business) AS activeShops
       FROM sales
      WHERE realm_id = ? AND status != 'VOIDED'`).bind(realmId).first();

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
    overview: overview || { revenue: 0, orders: 0, itemsSold: 0, activeShops: 0 },
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
