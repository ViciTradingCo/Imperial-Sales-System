/**
 * Stock intake as a transaction. Recording an intake:
 *   • logs the purchase (item, vendor, source hold, # of items, $ per item), and
 *   • adds the quantity to inventory stock (creating the item if it's new, with
 *     its sale price defaulting to the cost paid).
 * Both happen in one D1 batch (atomic), so stock and the intake log never drift.
 */
import { getDb } from './db.js';

/** Records one intake transaction. Returns the recent intake list. */
export async function recordIntake(env, business, { item, vendor, hold, numItems, pricePer, idempotencyKey }, realmId) {
  const db = await getDb(env);
  const idem = String(idempotencyKey || '').trim();
  if (idem) {
    const prior = await db.prepare('SELECT id FROM intake WHERE realm_id = ? AND business = ? AND idem = ? LIMIT 1')
      .bind(realmId, business, idem).first();
    if (prior) return listIntake(env, business, realmId); // already recorded — no double stock
  }
  const name = String(item || '').trim();
  if (!name) throw new Error('Item name is required.');
  const qty = Math.floor(Number(numItems));
  if (!isFinite(qty) || qty < 1) throw new Error('Number of items must be a whole number ≥ 1.');
  const per = Number(pricePer);
  if (!isFinite(per) || per < 0) throw new Error('$ per item must be a number ≥ 0.');
  const ts = new Date().toISOString();

  await db.batch([
    db.prepare(
      `INSERT INTO intake (realm_id, business, ts, item, vendor, source_hold, num_items, price_per, idem)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(realmId, business, ts, name, String(vendor || '').trim(), String(hold || '').trim(), qty, per, idem || null),
    // New item → created with sale price = cost paid; existing item → stock only.
    db.prepare(
      `INSERT INTO inventory (realm_id, business, item, price, stock, low_stock)
       VALUES (?, ?, ?, ?, ?, 0)
       ON CONFLICT (realm_id, business, item) DO UPDATE SET stock = stock + excluded.stock`
    ).bind(realmId, business, name, per, qty),
    // Debit the shop's coffers for what was paid.
    db.prepare(
      `INSERT INTO coffer_entries (realm_id, business, ts, kind, amount, note) VALUES (?, ?, ?, 'intake', ?, ?)`
    ).bind(realmId, business, ts, -(qty * per), name),
  ]);

  return listIntake(env, business, realmId);
}

/** The most recent intake transactions for a business. */
export async function listIntake(env, business, realmId, limit = 20) {
  const db = await getDb(env);
  const { results } = await db
    .prepare(
      `SELECT ts, item, vendor, source_hold, num_items, price_per
       FROM intake WHERE realm_id = ? AND business = ? ORDER BY id DESC LIMIT ?`
    )
    .bind(realmId, business, limit)
    .all();
  return (results || []).map((r) => ({
    ts: r.ts, item: r.item, vendor: r.vendor, hold: r.source_hold,
    numItems: r.num_items, pricePer: r.price_per,
  }));
}
