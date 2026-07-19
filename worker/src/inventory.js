/**
 * Inventory operations (D1). Each row belongs to one business. The rep-facing
 * "Status" (In Stock / Low / Out of Stock) is derived from the per-item manual
 * Low Stock threshold, matching the original ledger's behavior.
 */
import { getDb } from './db.js';

function statusFor(stock, low) {
  if (stock <= 0) return 'Out of Stock';
  if (low > 0 && stock <= low) return 'Low';
  return 'In Stock';
}

/** Every item for a business, ordered by name. */
export async function listInventory(env, business) {
  const db = await getDb(env);
  const { results } = await db
    .prepare('SELECT item, price, stock, low_stock FROM inventory WHERE business = ? ORDER BY item COLLATE NOCASE')
    .bind(business)
    .all();
  return (results || []).map((r) => ({
    item: r.item,
    price: r.price,
    stock: r.stock,
    lowStock: r.low_stock,
    status: statusFor(r.stock, r.low_stock),
  }));
}

/** Adds or updates one item (keyed by business + item name). */
export async function upsertItem(env, business, { item, price, stock, lowStock }) {
  const db = await getDb(env);
  const name = String(item || '').trim();
  if (!name) throw new Error('Item name is required.');
  const p = Number(price);
  const s = Math.floor(Number(stock));
  const l = Math.floor(Number(lowStock));
  if (!isFinite(p) || p < 0) throw new Error('Price must be a number ≥ 0.');
  if (!isFinite(s) || s < 0) throw new Error('Stock must be a whole number ≥ 0.');
  const low = isFinite(l) && l > 0 ? l : 0;
  await db
    .prepare(
      `INSERT INTO inventory (business, item, price, stock, low_stock)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (business, item)
       DO UPDATE SET price = excluded.price, stock = excluded.stock, low_stock = excluded.low_stock`
    )
    .bind(business, name, p, s, low)
    .run();
  return listInventory(env, business);
}

/** Removes an item from a business's inventory. */
export async function deleteItem(env, business, item) {
  const db = await getDb(env);
  await db
    .prepare('DELETE FROM inventory WHERE business = ? AND item = ?')
    .bind(business, String(item || '').trim())
    .run();
  return listInventory(env, business);
}
