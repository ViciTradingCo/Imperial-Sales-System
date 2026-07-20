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

  return { overview: overview || { revenue: 0, orders: 0, itemsSold: 0, activeShops: 0 }, businesses, holds, underpriced, lowStock };
}
