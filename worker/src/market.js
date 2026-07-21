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
 *   • lowStock    — items at or below their own low-stock threshold.
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
 * Aggregates per-item sales from the stored summaries, but ONLY for items in the
 * master index (new/off-index items are kept out of the market so the data stays
 * clean). Names are canonicalized to their master spelling.
 */
function itemStats(saleRows, master) {
  const exact = new Map();
  master.forEach((it) => exact.set(normalizeItem(it.name), it));
  const map = {};
  (saleRows || []).forEach((r) => {
    parseSaleItems(r.items).lines.forEach((l) => {
      const hit = exact.get(normalizeItem(l.name)) || matchMasterItem(l.name, master);
      if (!hit) return; // not in the master index → excluded from market
      const key = hit.name;
      const m = map[key] || (map[key] = { item: key, qty: 0, revenue: 0, orders: 0 });
      m.qty += l.qty;
      m.revenue += l.qty * l.price;
      m.orders += 1;
    });
  });
  return Object.values(map).sort((a, b) => b.revenue - a.revenue);
}

export async function marketAnalysis(env) {
  const db = await getDb(env);

  const overview = await db.prepare(
    `SELECT COALESCE(SUM(total), 0) AS revenue,
            COUNT(*) AS orders,
            COALESCE(SUM(qty_total), 0) AS itemsSold,
            COUNT(DISTINCT business) AS activeShops
       FROM sales
      WHERE status != 'VOIDED'`).first();

  const businesses = ((await db.prepare(
    `SELECT business,
            COUNT(*) AS orders,
            COALESCE(SUM(qty_total), 0) AS items,
            COALESCE(SUM(total), 0) AS revenue
       FROM sales
      WHERE status != 'VOIDED'
      GROUP BY business
      ORDER BY revenue DESC
      LIMIT 200`).all()).results) || [];

  const holds = ((await db.prepare(
    `SELECT hold,
            COUNT(*) AS orders,
            COALESCE(SUM(qty_total), 0) AS items,
            COALESCE(SUM(total), 0) AS revenue
       FROM sales
      WHERE status != 'VOIDED' AND hold IS NOT NULL AND hold != ''
      GROUP BY hold
      ORDER BY revenue DESC`).all()).results) || [];

  const underpriced = ((await db.prepare(
    `SELECT i.business AS business, i.item AS item,
            i.price AS salePrice, AVG(k.price_per) AS avgCost
       FROM inventory i
       JOIN intake k ON k.business = i.business AND k.item = i.item
      GROUP BY i.business, i.item
     HAVING i.price < AVG(k.price_per)
      ORDER BY (AVG(k.price_per) - i.price) DESC
      LIMIT 50`).all()).results) || [];

  const lowStock = ((await db.prepare(
    `SELECT business, item, stock, low_stock AS lowStock
       FROM inventory
      WHERE low_stock > 0 AND stock <= low_stock
      ORDER BY (low_stock - stock) DESC
      LIMIT 50`).all()).results) || [];

  const master = await listItemIndex(env);
  const saleRows = ((await db.prepare(
    `SELECT items FROM sales WHERE status != 'VOIDED'`).all()).results) || [];
  const items = itemStats(saleRows, master);

  // Pricing anomalies vs the master base values, using the network thresholds.
  const settings = await readSettings(env);
  const overX = settingVal(settings, 'Overpricing threshold (x item average)', 1.5);
  const underX = settingVal(settings, 'Undercutting threshold (x item average)', 0.5);
  const masterByNorm = new Map(master.map((m) => [normalizeItem(m.name), m]));
  const invRows = ((await db.prepare('SELECT business, item, price FROM inventory').all()).results) || [];
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
       FROM sales WHERE status != 'VOIDED'
      GROUP BY day ORDER BY day DESC LIMIT 30`).all()).results) || []).reverse();

  return {
    overview: overview || { revenue: 0, orders: 0, itemsSold: 0, activeShops: 0 },
    businesses, holds, items, underpriced, lowStock,
    overpriced: overpriced.slice(0, 50), undercut: undercut.slice(0, 50),
    thresholds: { over: overX, under: underX }, trends,
  };
}

/**
 * A single hold's report — the slice a Court oversees. Scoped to sales made in
 * that hold: overview, the shops trading there, and the items moving there.
 */
export async function holdReport(env, hold) {
  const db = await getDb(env);
  const h = String(hold || '').trim();
  if (!h) return { hold: '', overview: { revenue: 0, orders: 0, itemsSold: 0, activeShops: 0 }, businesses: [], items: [] };

  const overview = await db.prepare(
    `SELECT COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders,
            COALESCE(SUM(qty_total), 0) AS itemsSold, COUNT(DISTINCT business) AS activeShops
       FROM sales WHERE status != 'VOIDED' AND hold = ?`).bind(h).first();

  const businesses = ((await db.prepare(
    `SELECT business, COUNT(*) AS orders,
            COALESCE(SUM(qty_total), 0) AS items, COALESCE(SUM(total), 0) AS revenue
       FROM sales WHERE status != 'VOIDED' AND hold = ?
      GROUP BY business ORDER BY revenue DESC LIMIT 200`).bind(h).all()).results) || [];

  const saleRows = ((await db.prepare(
    `SELECT items FROM sales WHERE status != 'VOIDED' AND hold = ?`).bind(h).all()).results) || [];

  return { hold: h, overview: overview || { revenue: 0, orders: 0, itemsSold: 0, activeShops: 0 }, businesses, items: itemStats(saleRows, await listItemIndex(env)) };
}
