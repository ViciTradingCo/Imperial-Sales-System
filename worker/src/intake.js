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

/**
 * Records a delivery — ONE OR MANY items — as a single atomic write.
 *
 * A trip to a supplier brings back a crate, not an item. Recording it as five
 * separate calls is what the ingredient basket did, and it had the flaw every
 * client-side loop has: a dropped connection between line three and line four
 * leaves a delivery that half happened, with no record saying so. Here every
 * line is validated BEFORE anything is written and all of them go in one
 * `db.batch`, so a delivery either lands whole or not at all.
 *
 * The SUPPLIER is per delivery, not per line — one trip, one vendor, one
 * region. Everything that differs item by item (cost, sale price, whether it is
 * an ingredient) is on the line.
 */
export async function recordIntakeLines(env, business, { items, vendor, hold, fromBusiness, idempotencyKey }, realmId) {
  const db = await getDb(env);
  const lines = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!lines.length) throw new Error('Add at least one item to the delivery.');

  // One key for the whole delivery; each row stores `key#n`. Because the lines
  // are written atomically, the presence of line 0 proves the rest landed too —
  // so one lookup is enough to make a retry harmless.
  const idem = String(idempotencyKey || '').trim();
  if (idem) {
    // The bare key too: single-item deliveries stored it unsuffixed until this
    // became multi-line, and a retry that spans the deploy must still not
    // double the stock.
    const prior = await db.prepare(
      'SELECT id FROM intake WHERE realm_id = ? AND business = ? AND idem IN (?, ?) LIMIT 1')
      .bind(realmId, business, idem + '#0', idem).first();
    if (prior) return listIntake(env, business, realmId); // already recorded — no double stock
  }

  // Bought from a REGISTERED company, when it was. Resolved against the realm's
  // own companies so it is a real join rather than a second free-text field —
  // and a shop cannot record buying from itself, which would credit its own
  // region for supply that never moved.
  let from = String(fromBusiness || '').trim();
  if (from) {
    const known = await db.prepare(
      'SELECT business FROM companies WHERE realm_id = ? AND lower(business) = ?')
      .bind(realmId, from.toLowerCase()).first();
    if (!known) throw new Error('No registered company called "' + from + '" in this realm.');
    if (known.business.toLowerCase() === String(business || '').trim().toLowerCase()) {
      throw new Error('A shop cannot record buying from itself.');
    }
    from = known.business;
  }

  /**
   * The name this shop ALREADY lists an item under, if it does.
   *
   * The inventory's uniqueness is on the raw name, so "iron sword" and "Iron
   * Sword" are two rows to SQLite. A delivery typed with different casing was
   * silently creating a second listing with its own stock and its own price —
   * which reads exactly like "I recorded the intake and the stock did not go
   * up", because the stock went up on a row nobody was looking at.
   *
   * `claimed` extends that WITHIN one delivery: two lines for the same item in
   * different cases must land on one row, and neither is in the inventory table
   * yet for the other to find.
   */
  const claimed = new Map();
  const resolveName = async (name) => {
    const key = name.toLowerCase();
    if (claimed.has(key)) return claimed.get(key);
    const existing = await db.prepare(
      'SELECT item FROM inventory WHERE realm_id = ? AND business = ? AND lower(item) = ?')
      .bind(realmId, business, key).first();
    const invName = existing ? existing.item : name;
    claimed.set(key, invName);
    return invName;
  };

  // VALIDATE EVERYTHING FIRST. A bad line 4 must not leave lines 1-3 recorded,
  // and the message has to say which line so it can be found on a long list.
  const plan = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const where = lines.length > 1 ? ' (item ' + (i + 1) + ')' : '';
    const name = String(l.item || '').trim();
    if (!name) throw new Error('Item name is required.' + where);
    const qty = Math.floor(Number(l.numItems));
    if (!isFinite(qty) || qty < 1) throw new Error('Number of items must be a whole number ≥ 1.' + where);
    const per = Number(l.pricePer);
    if (!isFinite(per) || per < 0) throw new Error('$ per item must be a number ≥ 0.' + where);
    // What the shop will CHARGE, as opposed to what it paid. Optional: left
    // blank it keeps whatever price the item already carries, and a first
    // delivery falls back to the cost. Blank must not clobber a price the owner
    // already set — restocking is not repricing.
    const askedSale = String(l.salePrice === undefined || l.salePrice === null ? '' : l.salePrice).trim();
    let sale = null;
    if (askedSale !== '') {
      sale = Number(askedSale);
      if (!isFinite(sale) || sale < 0) throw new Error('Sale price must be a number ≥ 0.' + where);
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
    const ingGiven = l.ingredient !== undefined && l.ingredient !== null && l.ingredient !== '';
    plan.push({ name, qty, per, sale, ing: l.ingredient ? 1 : 0, ingGiven, invName: await resolveName(name) });
  }

  const ts = new Date().toISOString();
  const stmts = [];
  plan.forEach((p, i) => {
    stmts.push(db.prepare(
      `INSERT INTO intake (realm_id, business, ts, item, vendor, source_hold, num_items, price_per, idem, from_business)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(realmId, business, ts, p.name, String(vendor || '').trim(), String(hold || '').trim(),
      p.qty, p.per, idem ? idem + '#' + i : null, from));
    // New item → priced at the sale price given, or at the cost paid if none.
    // Existing item → stock only, unless a sale price was explicitly given.
    stmts.push(db.prepare(
      `INSERT INTO inventory (realm_id, business, item, price, stock, low_stock, ingredient)
       VALUES (?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT (realm_id, business, item) DO UPDATE SET
         stock = stock + excluded.stock,
         price = CASE WHEN ? THEN excluded.price ELSE inventory.price END,
         ingredient = CASE WHEN ? THEN excluded.ingredient ELSE inventory.ingredient END`
    ).bind(realmId, business, p.invName, p.sale === null ? p.per : p.sale, p.qty, p.ing,
      p.sale === null ? 0 : 1, p.ingGiven ? 1 : 0));
    // Debit the shop's coffers for what was paid. ONE ENTRY PER LINE, rounded
    // per line: each line is its own intake row, and deleting one refunds
    // exactly what that line took. A single combined debit could not be undone
    // a line at a time without the two disagreeing by a coin.
    stmts.push(db.prepare(
      `INSERT INTO coffer_entries (realm_id, business, ts, kind, amount, note) VALUES (?, ?, ?, 'intake', ?, ?)`
    ).bind(realmId, business, ts, -coin(p.qty * p.per), p.name));
  });

  await db.batch(stmts);
  return listIntake(env, business, realmId);
}

/**
 * Records one intake transaction. Returns the recent intake list.
 *
 * The single-item shape, kept because most deliveries are one thing and a
 * caller should not have to build an array to say so.
 */
export async function recordIntake(env, business, entry, realmId) {
  return recordIntakeLines(env, business, { ...entry, items: [entry] }, realmId);
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
 *
 * UNLESS THE SHOP PAYS FOR IT. An owner can set a harvest rate on an item —
 * what they will give one of their own people per unit for bringing it in —
 * and a harvest claimed against that rate is a real cost: the coffer is debited
 * and the intake row carries the price, so it counts toward what the stock
 * actually cost the shop. That is the difference from wages, which this system
 * only ever RECORDS as owed: this is not paying someone for their time, it is
 * buying goods off them at a price the owner set in advance, and it settles the
 * same way a delivery from any other supplier does.
 *
 * THE RATE IS READ FROM THE ITEM, never taken from the request. The person
 * claiming the payment is the last person who should be able to say what it is
 * worth.
 */
export async function recordHarvest(env, business, { item, numItems, ingredient, claimPay, employee, idempotencyKey }, realmId) {
  const db = await getDb(env);
  const idem = String(idempotencyKey || '').trim();
  if (idem) {
    const prior = await db.prepare('SELECT id FROM intake WHERE realm_id = ? AND business = ? AND idem = ? LIMIT 1')
      .bind(realmId, business, idem).first();
    // Same SHAPE as a first-time record, not a bare list: a caller that has to
    // tell a retry apart from a real one has already lost the argument.
    if (prior) return { intake: await listIntake(env, business, realmId), paid: 0, rate: 0, duplicate: true };
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
    'SELECT item, harvest_pay FROM inventory WHERE realm_id = ? AND business = ? AND lower(item) = ?')
    .bind(realmId, business, name.toLowerCase()).first();
  const invName = existing ? existing.item : name;

  // The rate the OWNER set on this item, and what this haul therefore earns.
  // Rounded once on the total, like every other amount in the ledger.
  const rate = claimPay ? Number((existing && existing.harvest_pay) || 0) : 0;
  if (claimPay && !(rate > 0)) {
    throw new Error('There is no harvest rate set for "' + name + '". An owner sets one on the item in Inventory.');
  }
  const owed = coin(qty * rate);
  const who = String(employee || '').trim();
  const ts = new Date().toISOString();

  const stmts = [
    // Logged as intake with HARVEST as the vendor, so it appears in the
    // delivery history and can be deleted like any other mistake. The PRICE is
    // the harvest rate when one was claimed and 0 otherwise — an unpaid
    // harvest cost nothing, and market.js excludes a zero from valuation so a
    // free thing never looks like a thing worth nothing.
    db.prepare(
      `INSERT INTO intake (realm_id, business, ts, item, vendor, source_hold, num_items, price_per, idem, from_business)
       VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, '')`
    ).bind(realmId, business, ts, name, HARVEST_VENDOR, qty, rate, idem || null),
    db.prepare(
      `INSERT INTO inventory (realm_id, business, item, price, stock, low_stock, ingredient)
       VALUES (?, ?, ?, 0, ?, 0, ?)
       ON CONFLICT (realm_id, business, item) DO UPDATE SET
         stock = stock + excluded.stock,
         ingredient = CASE WHEN ? THEN excluded.ingredient ELSE inventory.ingredient END`
    ).bind(realmId, business, invName, qty, ing, ingGiven ? 1 : 0),
  ];
  // Paid for, so the coffer pays for it — a business expense, recorded the
  // moment the goods are handed over, exactly as a delivery from an outside
  // supplier is. Nothing is written when nobody was paid.
  if (owed > 0) {
    stmts.push(db.prepare(
      `INSERT INTO coffer_entries (realm_id, business, ts, kind, amount, note) VALUES (?, ?, ?, 'harvest-pay', ?, ?)`
    ).bind(realmId, business, ts, -owed, 'Harvest: ' + name + ' ×' + qty + (who ? ' by ' + who : '')));
  }

  await db.batch(stmts);

  return { intake: await listIntake(env, business, realmId), paid: owed, rate };
}

/** How a harvested delivery is labelled in the log. */
export const HARVEST_VENDOR = 'Farm/Harvest';

/** The most recent intake transactions for a business. */
export async function listIntake(env, business, realmId, limit = 20) {
  const db = await getDb(env);
  const { results } = await db
    .prepare(
      `SELECT id, ts, item, vendor, source_hold, num_items, price_per, idem, from_business
       FROM intake WHERE realm_id = ? AND business = ? ORDER BY id DESC LIMIT ?`
    )
    .bind(realmId, business, limit)
    .all();
  return (results || []).map((r) => ({
    id: r.id,
    // WHICH TRIP this line arrived on. Every line of one delivery shares the
    // idempotency key and differs only in the `#n` suffix, so the stem is the
    // delivery — the screens group on it rather than guessing from a matching
    // timestamp and vendor.
    //
    // A row with no key stands alone: single-item deliveries predate the
    // multi-line form, and two of them on the same day were never one trip.
    delivery: r.idem ? String(r.idem).split('#')[0] : 'row:' + r.id,
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
