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
import { listInventory, listingsByName } from './inventory.js';
import { coin } from './money.js';
import { lineSummary } from './lines.js';

/**
 * Turns a delivery's lines into what will actually be written, or throws.
 *
 * VALIDATE EVERYTHING FIRST. A bad line 4 must not leave lines 1-3 recorded,
 * and the message says which line so it can be found on a long list.
 *
 * The sibling of `planHaul`, and deliberately the same shape: a delivery and a
 * haul differ in what they ask for, not in how a list of lines is checked.
 */
async function planDelivery(db, business, realmId, lines) {
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
  const shelf = await listingsByName(db, realmId, business, lines.map((l) => l && l.item));
  const claimed = new Map();
  const resolveName = (name) => {
    const key = name.toLowerCase();
    if (!claimed.has(key)) {
      const existing = shelf.get(key);
      claimed.set(key, existing ? existing.item : name);
    }
    return claimed.get(key);
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
    plan.push({ name, qty, per, sale, ing: l.ingredient ? 1 : 0, ingGiven, invName: resolveName(name) });
  }

  return plan;
}

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

  const plan = await planDelivery(db, business, realmId, lines);

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
  });

  /**
   * ONE DEBIT FOR THE TRIP, not one per line.
   *
   * A delivery is a single act — coin left the coffer once — and a coffer
   * showing six lines for one trip to the smith is a coffer you have to
   * reassemble in your head before you can check it against anything.
   *
   * It is also the only way to obey the money rule. Rounding every line
   * compounds the loss: three lines at 10.5 must take 31, not three tens. The
   * total is settled once, here, and `ref` ties it to the trip so removing a
   * line later refunds against the figure that actually went out.
   */
  const spent = coin(plan.reduce((n, p) => n + p.qty * p.per, 0));
  if (spent > 0) {
    stmts.push(db.prepare(
      `INSERT INTO coffer_entries (realm_id, business, ts, kind, amount, note, ref) VALUES (?, ?, ?, 'intake', ?, ?, ?)`
    ).bind(realmId, business, ts, -spent, lineSummary(plan.map((p) => ({ item: p.name, qty: p.qty }))), idem || null));
  }

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
 * Turns a haul's lines into what will actually be written, or throws.
 *
 * EVERY LINE IS CHECKED BEFORE ANY IS WRITTEN — a bad line 3 must not leave
 * lines 1 and 2 in the inventory — and the message says which line, so it can
 * be found on a long list.
 *
 * Two lines naming the same crop land on ONE listing whatever their casing:
 * the inventory's uniqueness is on the raw name, so "wheat" and "Wheat" would
 * otherwise become two rows with the morning's work split between them. The
 * lookup is cached per name because the listing and its rate are answers about
 * the same row, asked once.
 */
async function planHaul(db, business, realmId, asked, claimPay) {
  const shelf = await listingsByName(db, realmId, business, asked.map((l) => l && l.item));
  /**
   * The listing a name lands on, and what it pays.
   *
   * `claimed` is why this is not a bare map read: two lines of the same crop in
   * different cases must land on ONE listing, and for something the shop has
   * never stocked neither line is on the shelf for the other to find. The first
   * spelling in the haul wins, and the second joins it.
   */
  const claimed = new Map();
  const lookup = (name) => {
    const key = name.toLowerCase();
    if (!claimed.has(key)) {
      const row = shelf.get(key);
      claimed.set(key, { invName: row ? row.item : name, pay: Number((row && row.harvest_pay) || 0) });
    }
    return claimed.get(key);
  };

  const plan = [];
  for (let i = 0; i < asked.length; i++) {
    const l = asked[i] || {};
    const where = asked.length > 1 ? ' (item ' + (i + 1) + ')' : '';
    const name = String(l.item || '').trim();
    if (!name) throw new Error('Which item did you bring in?' + where);
    const qty = Math.floor(Number(l.numItems));
    if (!isFinite(qty) || qty < 1) throw new Error('How many? Enter a whole number of 1 or more.' + where);
    const { invName, pay } = lookup(name);
    const ingGiven = l.ingredient !== undefined && l.ingredient !== null && l.ingredient !== '';
    // THE RATE IS READ FROM THE ITEM, never taken from the request.
    const rate = claimPay ? pay : 0;
    plan.push({ name, invName, qty, rate, ing: l.ingredient ? 1 : 0, ingGiven });
  }
  return plan;
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
export async function recordHarvest(env, business, { items, item, numItems, ingredient, claimPay, employee, idempotencyKey }, realmId) {
  const db = await getDb(env);
  const idem = String(idempotencyKey || '').trim();
  if (idem) {
    // The bare key as well as `#0`: a haul of one stored it unsuffixed until
    // this became multi-line, and a retry spanning the deploy must still not
    // double the crop.
    const prior = await db.prepare(
      'SELECT id FROM intake WHERE realm_id = ? AND business = ? AND idem IN (?, ?) LIMIT 1')
      .bind(realmId, business, idem + '#0', idem).first();
    // Same SHAPE as a first-time record, not a bare list: a caller that has to
    // tell a retry apart from a real one has already lost the argument.
    if (prior) return { intake: await listIntake(env, business, realmId), paid: 0, rate: 0, lines: [], duplicate: true };
  }

  /**
   * A HAUL, one or many. You come back from a morning's work with wheat AND
   * apples AND a hare, and recording that as three separate trips means three
   * lines in the delivery log for one walk back from the field — and three
   * chances for the connection to drop between them.
   *
   * The single-item shape is still accepted: it is what a page left open across
   * this deploy sends, and it is how every caller wrote it until now.
   */
  const asked = Array.isArray(items) && items.length ? items : [{ item, numItems, ingredient }];
  const plan = await planHaul(db, business, realmId, asked, claimPay);

  /**
   * A claim against nothing is still refused — but only when NOTHING in the
   * haul pays. A morning that brought in one crop the shop buys and one it does
   * not is an ordinary morning, and refusing the whole haul over the unpaid
   * half would make the tick box a trap.
   */
  if (claimPay && !plan.some((p) => p.rate > 0)) {
    throw new Error(plan.length === 1
      ? 'There is no harvest rate set for "' + plan[0].name + '". An owner sets one on the item in Inventory.'
      : 'None of these has a harvest rate set. An owner sets one on the item in Inventory.');
  }

  const who = String(employee || '').trim();
  const ts = new Date().toISOString();
  const stmts = [];
  plan.forEach((p, i) => {
    // Logged as intake with HARVEST as the vendor, so it appears in the
    // delivery history and can be deleted like any other mistake. The PRICE is
    // the harvest rate when one was claimed and 0 otherwise — an unpaid
    // harvest cost nothing, and market.js excludes a zero from valuation so a
    // free thing never looks like a thing worth nothing.
    //
    // Every line of one haul shares the key and differs by `#n`, which is what
    // makes the delivery log group them as the single trip they were.
    stmts.push(db.prepare(
      `INSERT INTO intake (realm_id, business, ts, item, vendor, source_hold, num_items, price_per, idem, from_business)
       VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, '')`
    ).bind(realmId, business, ts, p.name, HARVEST_VENDOR, p.qty, p.rate, idem ? idem + '#' + i : null));
    stmts.push(db.prepare(
      `INSERT INTO inventory (realm_id, business, item, price, stock, low_stock, ingredient)
       VALUES (?, ?, ?, 0, ?, 0, ?)
       ON CONFLICT (realm_id, business, item) DO UPDATE SET
         stock = stock + excluded.stock,
         ingredient = CASE WHEN ? THEN excluded.ingredient ELSE inventory.ingredient END`
    ).bind(realmId, business, p.invName, p.qty, p.ing, p.ingGiven ? 1 : 0));
  });

  // ONE WAGE ENTRY FOR THE HAUL, settled once, for the same two reasons a
  // delivery takes one debit: the shop paid a person once, and rounding each
  // line separately would shortchange them by a coin a line.
  const owed = coin(plan.reduce((n, p) => n + p.qty * p.rate, 0));
  if (owed > 0) {
    const paidFor = plan.filter((p) => p.rate > 0).map((p) => ({ item: p.name, qty: p.qty }));
    stmts.push(db.prepare(
      `INSERT INTO coffer_entries (realm_id, business, ts, kind, amount, note, ref) VALUES (?, ?, ?, 'harvest-pay', ?, ?, ?)`
    ).bind(realmId, business, ts, -owed, 'Harvest: ' + lineSummary(paidFor) + (who ? ' by ' + who : ''), idem || null));
  }

  await db.batch(stmts);

  return {
    intake: await listIntake(env, business, realmId),
    paid: owed,
    // The rate of the ONE line, when there is one. A haul of several has no
    // single rate, and inventing one would be a figure nobody could check.
    rate: plan.length === 1 ? plan[0].rate : 0,
    // Each line says WHAT and AT WHAT RATE; the money is the one settled figure
    // above. A per-line coin as well would be a second set of numbers that
    // cannot be made to add up to the first — which is the whole reason the
    // total is rounded once.
    lines: plan.map((p) => ({ item: p.name, qty: p.qty, rate: p.rate })),
  };
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

  /**
   * WHAT TO GIVE BACK, worked out against what actually went out.
   *
   * A delivery takes ONE debit, settled once on the whole trip — so the refund
   * for one of its lines is not that line's own price rounded down, it is the
   * difference the line makes to the trip's total. Removing all six lines of a
   * delivery then refunds exactly what the delivery took, to the coin, instead
   * of drifting by one per line.
   *
   * A row with no trip behind it — a delivery recorded before this, or one
   * saved without a key — falls back to its own figure, which is precisely what
   * it debited at the time. The `ref` on the coffer line is what tells the two
   * apart, so an old delivery is refunded by the old rule and cannot mint a
   * coin on the way out.
   */
  const stem = row.idem ? String(row.idem).split('#')[0] : '';
  let paid = coin(qty * (Number(row.price_per) || 0));
  if (stem) {
    // Was this trip settled ONCE? The `ref` on its coffer line is what says so.
    // Without one it predates the single debit and each of its lines took its
    // own rounded figure, so that is what each must give back.
    const settled = await db.prepare(
      `SELECT id FROM coffer_entries WHERE realm_id = ? AND business = ? AND ref = ?
        AND kind IN ('intake', 'harvest-pay') LIMIT 1`).bind(realmId, business, stem).first();
    if (settled) {
      // Siblings matched on the stem, never on a timestamp: `stem` and `stem#n`
      // are the same trip, and nothing else is.
      const { results } = await db.prepare(
        `SELECT id, num_items, price_per FROM intake
          WHERE realm_id = ? AND business = ? AND (idem = ? OR substr(idem, 1, ?) = ?)`)
        .bind(realmId, business, stem, stem.length + 1, stem + '#').all();
      const worth = (rows) => coin(rows.reduce((n, r) => n + (Number(r.num_items) || 0) * (Number(r.price_per) || 0), 0));
      const now = results || [];
      // WHAT THE TRIP COSTS NOW, LESS WHAT IT WILL COST WITHOUT THIS LINE —
      // measured against what is still on the books, never against the original
      // debit. Against the debit, the second line removed would give back what
      // the first already had, and by the last one the coffer would be up on
      // the deal. Difference by difference, the refunds sum to the debit.
      paid = worth(now) - worth(now.filter((r) => r.id !== row.id));
      if (paid < 0) paid = 0;
    }
  }
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
