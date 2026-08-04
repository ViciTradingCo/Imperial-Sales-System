/**
 * Stock intake as a transaction. Recording an intake:
 *   • logs the purchase (item, vendor, source hold, # of items, $ per item), and
 *   • adds the quantity to inventory stock (creating the item if it's new, at
 *     the sale price given — or at the cost paid when none is).
 * Both happen in one D1 batch (atomic), so stock and the intake log never drift.
 *
 * An entry can be DELETED to undo a mistyped delivery; see deleteIntake.
 */
import { getDb } from './db.js';
import { listInventory } from './inventory.js';

/** Records one intake transaction. Returns the recent intake list. */
export async function recordIntake(env, business, { item, vendor, hold, numItems, pricePer, salePrice, ingredient, idempotencyKey }, realmId) {
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
  // What the shop will CHARGE, as opposed to what it paid. Optional: left blank
  // it keeps whatever price the item already carries, and a first delivery falls
  // back to the cost. Blank must not clobber a price the owner already set —
  // restocking is not repricing.
  const askedSale = String(salePrice === undefined || salePrice === null ? '' : salePrice).trim();
  let sale = null;
  if (askedSale !== '') {
    sale = Number(askedSale);
    if (!isFinite(sale) || sale < 0) throw new Error('Sale price must be a number ≥ 0.');
  }
  // An INGREDIENT is stock the shop holds to craft with and does not sell. The
  // flag is set per delivery because that is when you know what the stock is
  // for; it can be changed later from the item's own editor.
  const ing = ingredient ? 1 : 0;
  const ts = new Date().toISOString();

  await db.batch([
    db.prepare(
      `INSERT INTO intake (realm_id, business, ts, item, vendor, source_hold, num_items, price_per, idem)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(realmId, business, ts, name, String(vendor || '').trim(), String(hold || '').trim(), qty, per, idem || null),
    // New item → priced at the sale price given, or at the cost paid if none.
    // Existing item → stock only, unless a sale price was explicitly given.
    db.prepare(
      `INSERT INTO inventory (realm_id, business, item, price, stock, low_stock, ingredient)
       VALUES (?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT (realm_id, business, item) DO UPDATE SET
         stock = stock + excluded.stock,
         price = CASE WHEN ? THEN excluded.price ELSE inventory.price END,
         ingredient = excluded.ingredient`
    ).bind(realmId, business, name, sale === null ? per : sale, qty, ing, sale === null ? 0 : 1),
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
      `SELECT id, ts, item, vendor, source_hold, num_items, price_per
       FROM intake WHERE realm_id = ? AND business = ? ORDER BY id DESC LIMIT ?`
    )
    .bind(realmId, business, limit)
    .all();
  return (results || []).map((r) => ({
    id: r.id,
    ts: r.ts, item: r.item, vendor: r.vendor, hold: r.source_hold,
    numItems: r.num_items, pricePer: r.price_per,
  }));
}

/**
 * Deletes one intake entry, undoing what it did: the stock it added comes back
 * out and the coffer debit is refunded.
 *
 * The way to correct a mistyped delivery. Sales have a void; intake had nothing,
 * so a fat-fingered quantity was permanent.
 *
 * STOCK IS FLOORED AT ZERO. Some of a delivery may already have been sold, and
 * reversing it in full would leave a negative count — a number that means
 * nothing and that no other screen is prepared for. The response says how many
 * could not be taken back so the owner is told rather than quietly corrected.
 *
 * The INVENTORY LISTING SURVIVES even when this empties it. A listing is the
 * shop's price for that item, not a claim to be holding one; deleting it because
 * the count reached zero would throw away the sale price and every setting on it.
 */
export async function deleteIntake(env, business, id, realmId) {
  const db = await getDb(env);
  const row = await db.prepare('SELECT * FROM intake WHERE id = ? AND realm_id = ? AND business = ?')
    .bind(Number(id), realmId, business).first();
  if (!row) throw new Error('That intake entry no longer exists.');

  const qty = Number(row.num_items) || 0;
  const paid = qty * (Number(row.price_per) || 0);
  const inv = await db.prepare('SELECT stock FROM inventory WHERE realm_id = ? AND business = ? AND item = ?')
    .bind(realmId, business, row.item).first();
  const have = inv ? Number(inv.stock) || 0 : 0;
  const removed = Math.min(qty, have);

  const stmts = [db.prepare('DELETE FROM intake WHERE id = ?').bind(row.id)];
  if (inv && removed > 0) {
    stmts.push(db.prepare('UPDATE inventory SET stock = stock - ? WHERE realm_id = ? AND business = ? AND item = ?')
      .bind(removed, realmId, business, row.item));
  }
  // Refund what the shop paid, so the coffer matches the records again.
  if (paid) {
    stmts.push(db.prepare(
      `INSERT INTO coffer_entries (realm_id, business, ts, kind, amount, note) VALUES (?, ?, ?, 'intake-void', ?, ?)`
    ).bind(realmId, business, new Date().toISOString(), paid, 'Removed intake: ' + row.item));
  }
  await db.batch(stmts);

  return {
    ok: true,
    item: row.item,
    removed,
    shortBy: qty - removed,   // already sold on, so not recoverable from stock
    refunded: paid,
    intake: await listIntake(env, business, realmId),
    inventory: await listInventory(env, business, realmId),
  };
}
