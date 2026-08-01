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

/**
 * Low/out-of-stock report for a business. `out` = stock ≤ 0; `low` = a positive
 * stock at or below the item's Low Stock threshold. Items with no threshold only
 * appear once they're fully out. Ordered worst-first.
 */
export async function lowStockReport(env, business, realmId) {
  const db = await getDb(env);
  const { results } = await db
    .prepare('SELECT item, price, stock, low_stock FROM inventory WHERE realm_id = ? AND business = ? ' +
      'AND (stock <= 0 OR (low_stock > 0 AND stock <= low_stock)) ORDER BY stock ASC, item COLLATE NOCASE')
    .bind(realmId, business).all();
  const out = [], low = [];
  (results || []).forEach((r) => {
    const row = { item: r.item, price: r.price, stock: r.stock, lowStock: r.low_stock };
    (r.stock <= 0 ? out : low).push(row);
  });
  return { out, low };
}

/** Every item for a business, ordered by name. */
export async function listInventory(env, business, realmId) {
  const db = await getDb(env);
  const { results } = await db
    .prepare('SELECT item, price, stock, low_stock FROM inventory WHERE realm_id = ? AND business = ? ORDER BY item COLLATE NOCASE')
    .bind(realmId, business)
    .all();
  return (results || []).map((r) => ({
    item: r.item,
    price: r.price,
    stock: r.stock,
    lowStock: r.low_stock,
    status: statusFor(r.stock, r.low_stock),
  }));
}

/**
 * Adds or updates an item's DETAILS (sale price + low-stock threshold). Stock is
 * NOT set here — it's driven by intake (in) and sales (out). A brand-new item
 * starts at 0 stock; record an intake to stock it.
 */
export async function upsertItem(env, business, { item, price, lowStock }, realmId) {
  const db = await getDb(env);
  const name = String(item || '').trim();
  if (!name) throw new Error('Item name is required.');
  const p = Number(price);
  const l = Math.floor(Number(lowStock));
  if (!isFinite(p) || p < 0) throw new Error('Price must be a number ≥ 0.');
  const low = isFinite(l) && l > 0 ? l : 0;
  await db
    .prepare(
      `INSERT INTO inventory (realm_id, business, item, price, stock, low_stock)
       VALUES (?, ?, ?, ?, 0, ?)
       ON CONFLICT (realm_id, business, item)
       DO UPDATE SET price = excluded.price, low_stock = excluded.low_stock`
    )
    .bind(realmId, business, name, p, low)
    .run();
  return listInventory(env, business, realmId);
}

/**
 * Bulk upsert from a pasted/CSV list. Each row: { item, price?, stock?, lowStock? }.
 * Omitted numeric fields keep the item's current value (or 0 for a new item), so
 * you can paste just names+prices without wiping stock. Rows with a non-numeric
 * price (e.g. a header line) are skipped.
 */
export async function importInventory(env, business, rows, realmId) {
  const db = await getDb(env);
  const cur = {};
  (await listInventory(env, business, realmId)).forEach((it) => { cur[it.item.toLowerCase()] = it; });
  const pick = (v, existing, dflt) => {
    if (v === undefined || v === null || String(v).trim() === '') return existing;
    const n = Number(v);
    return isFinite(n) ? n : dflt;
  };
  const stmts = [];
  let imported = 0;
  (rows || []).forEach((r) => {
    const name = String(r.item || '').trim();
    if (!name) return;
    const ex = cur[name.toLowerCase()] || {};
    const price = pick(r.price, ex.price, NaN);
    if (!isFinite(price) || price < 0) return; // skip headers / bad rows
    const stock = Math.floor(pick(r.stock, ex.stock !== undefined ? ex.stock : 0, 0));
    const lowRaw = Math.floor(pick(r.lowStock, ex.lowStock !== undefined ? ex.lowStock : 0, 0));
    const low = isFinite(lowRaw) && lowRaw > 0 ? lowRaw : 0;
    stmts.push(db.prepare(
      `INSERT INTO inventory (realm_id, business, item, price, stock, low_stock) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (realm_id, business, item) DO UPDATE SET price = excluded.price, stock = excluded.stock, low_stock = excluded.low_stock`
    ).bind(realmId, business, name, price, isFinite(stock) ? stock : 0, low));
    imported++;
  });
  if (stmts.length) await db.batch(stmts);
  return { imported, inventory: await listInventory(env, business, realmId) };
}

/** Removes an item from a business's inventory. */
export async function deleteItem(env, business, item, realmId) {
  const db = await getDb(env);
  await db
    .prepare('DELETE FROM inventory WHERE realm_id = ? AND business = ? AND item = ?')
    .bind(realmId, business, String(item || '').trim())
    .run();
  return listInventory(env, business, realmId);
}
