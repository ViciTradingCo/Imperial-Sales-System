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
import { coin } from './money.js';

/** Records one intake transaction. Returns the recent intake list. */
export async function recordIntake(env, business, { item, vendor, hold, fromBusiness, numItems, pricePer, salePrice, ingredient, idempotencyKey }, realmId) {
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
  /**
   * An INGREDIENT is stock the shop holds to craft with and does not sell.
   *
   * Only applied when the caller actually says so. It used to be written on
   * every delivery from a checkbox that defaults to off, which silently UNDID
   * the flag: an owner marked something an ingredient in the item editor, took
   * a routine delivery of it, and it quietly became sellable again — back in
   * the register, back in the pricing statistics. A restock is not a
   * re-classification, exactly as it is not a repricing.
   */
  const ingGiven = ingredient !== undefined && ingredient !== null && ingredient !== '';
  const ing = ingredient ? 1 : 0;
  // Bought from a REGISTERED company, when it was. Resolved against the realm's
  // own companies so it is a real join rather than a second free-text field —
  // and a shop cannot record buying from itself, which would credit its own
  // region for supply that never moved.
  let from = String(fromBusiness || '').trim();
  if (from) {
    const known = await (await getDb(env)).prepare(
      'SELECT business FROM companies WHERE realm_id = ? AND lower(business) = ?')
      .bind(realmId, from.toLowerCase()).first();
    if (!known) throw new Error('No registered company called "' + from + '" in this realm.');
    if (known.business.toLowerCase() === String(business || '').trim().toLowerCase()) {
      throw new Error('A shop cannot record buying from itself.');
    }
    from = known.business;
  }
  /**
   * The name this shop ALREADY lists it under, if it does.
   *
   * The inventory's uniqueness is on the raw name, so "iron sword" and "Iron
   * Sword" are two rows to SQLite. A delivery typed with different casing was
   * silently creating a second listing with its own stock and its own price —
   * which reads exactly like "I recorded the intake and the stock did not go
   * up", because the stock went up on a row nobody was looking at.
   */
  const existing = await db.prepare(
    'SELECT item FROM inventory WHERE realm_id = ? AND business = ? AND lower(item) = ?')
    .bind(realmId, business, name.toLowerCase()).first();
  const invName = existing ? existing.item : name;

  const ts = new Date().toISOString();

  await db.batch([
    db.prepare(
      `INSERT INTO intake (realm_id, business, ts, item, vendor, source_hold, num_items, price_per, idem, from_business)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(realmId, business, ts, name, String(vendor || '').trim(), String(hold || '').trim(), qty, per, idem || null, from),
    // New item → priced at the sale price given, or at the cost paid if none.
    // Existing item → stock only, unless a sale price was explicitly given.
    db.prepare(
      `INSERT INTO inventory (realm_id, business, item, price, stock, low_stock, ingredient)
       VALUES (?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT (realm_id, business, item) DO UPDATE SET
         stock = stock + excluded.stock,
         price = CASE WHEN ? THEN excluded.price ELSE inventory.price END,
         ingredient = CASE WHEN ? THEN excluded.ingredient ELSE inventory.ingredient END`
    ).bind(realmId, business, invName, sale === null ? per : sale, qty, ing,
      sale === null ? 0 : 1, ingGiven ? 1 : 0),
    // Debit the shop's coffers for what was paid.
    db.prepare(
      `INSERT INTO coffer_entries (realm_id, business, ts, kind, amount, note) VALUES (?, ?, ?, 'intake', ?, ?)`
    ).bind(realmId, business, ts, -coin(qty * per), name),
  ]);

  return listIntake(env, business, realmId);
}

/**
 * FARM / HARVEST — stock that was produced, not bought.
 *
 * A farm brings in a crop; a mine brings up ore; a hunter comes back with
 * hides. No vendor, no region of purchase, and above all no COST: nobody was
 * paid, so nothing leaves the coffer. Recording these as an intake at 0 was the
 * only way before, and it lied twice — it invented a purchase from an empty
 * vendor, and it dragged the item's average value toward zero in every market
 * report, because a free thing looks like a thing worth nothing.
 *
 * So it is a different verb with its own row: the stock goes up, and that is
 * all that happens.
 */
export async function recordHarvest(env, business, { item, numItems, ingredient, idempotencyKey }, realmId) {
  const db = await getDb(env);
  const idem = String(idempotencyKey || '').trim();
  if (idem) {
    const prior = await db.prepare('SELECT id FROM intake WHERE realm_id = ? AND business = ? AND idem = ? LIMIT 1')
      .bind(realmId, business, idem).first();
    if (prior) return listIntake(env, business, realmId);
  }
  const name = String(item || '').trim();
  if (!name) throw new Error('Which item did you bring in?');
  const qty = Math.floor(Number(numItems));
  if (!isFinite(qty) || qty < 1) throw new Error('How many? Enter a whole number of 1 or more.');

  const ingGiven = ingredient !== undefined && ingredient !== null && ingredient !== '';
  const ing = ingredient ? 1 : 0;
  // Same case-insensitive match as a delivery: a harvest must land on the
  // listing the owner is already looking at.
  const existing = await db.prepare(
    'SELECT item FROM inventory WHERE realm_id = ? AND business = ? AND lower(item) = ?')
    .bind(realmId, business, name.toLowerCase()).first();
  const invName = existing ? existing.item : name;
  const ts = new Date().toISOString();

  await db.batch([
    // Logged as intake with HARVEST as the vendor and no price, so it appears
    // in the delivery history and can be deleted like any other mistake — but
    // priced at nothing, which market.js already excludes from valuation.
    db.prepare(
      `INSERT INTO intake (realm_id, business, ts, item, vendor, source_hold, num_items, price_per, idem, from_business)
       VALUES (?, ?, ?, ?, ?, '', ?, 0, ?, '')`
    ).bind(realmId, business, ts, name, HARVEST_VENDOR, qty, idem || null),
    db.prepare(
      `INSERT INTO inventory (realm_id, business, item, price, stock, low_stock, ingredient)
       VALUES (?, ?, ?, 0, ?, 0, ?)
       ON CONFLICT (realm_id, business, item) DO UPDATE SET
         stock = stock + excluded.stock,
         ingredient = CASE WHEN ? THEN excluded.ingredient ELSE inventory.ingredient END`
    ).bind(realmId, business, invName, qty, ing, ingGiven ? 1 : 0),
    // No coffer entry. Nobody was paid.
  ]);

  return listIntake(env, business, realmId);
}

/** How a harvested delivery is labelled in the log. */
export const HARVEST_VENDOR = 'Farm/Harvest';

/** The most recent intake transactions for a business. */
export async function listIntake(env, business, realmId, limit = 20) {
  const db = await getDb(env);
  const { results } = await db
    .prepare(
      `SELECT id, ts, item, vendor, source_hold, num_items, price_per, from_business
       FROM intake WHERE realm_id = ? AND business = ? ORDER BY id DESC LIMIT ?`
    )
    .bind(realmId, business, limit)
    .all();
  return (results || []).map((r) => ({
    id: r.id,
    ts: r.ts, item: r.item, vendor: r.vendor, hold: r.source_hold,
    fromBusiness: r.from_business || '',
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
  // Mirror the debit exactly — it was rounded down when it went out, so the
  // refund has to round down too or removing an intake would mint a coin.
  const paid = coin(qty * (Number(row.price_per) || 0));
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
