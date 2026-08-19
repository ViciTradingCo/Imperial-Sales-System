/**
 * Inventory operations (D1). Each row belongs to one business. The rep-facing
 * "Status" (In Stock / Low / Out of Stock) is derived from the per-item manual
 * Low Stock threshold, matching the original ledger's behavior.
 */
import { getDb, getFlag, setFlag } from './db.js';
import { listItemIndex, matchMasterItem, normalizeItem, notePendingItem } from './item-index.js';

const ts = () => new Date().toISOString();

/**
 * WHAT KIND OF THING a listing is — food, drink, a weapon.
 *
 * Stored comma-joined and LOWERCASE on the row, so a tag compares by one rule
 * everywhere and nothing has to remember whether the shop typed "Drink" or
 * "drink". The realm's own spelling is applied when it is DISPLAYED, the same
 * way money and regions are — the vocabulary lives in realm prefs and a realm
 * renaming a kind must never make a listing's tag unreadable.
 *
 * Per LISTING and not per item, exactly as `ingredient` is: what a thing is FOR
 * is the shop's answer, and one tavern's drink is a hedge wizard's reagent.
 */
export function parseTags(field) {
  return String(field || '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/** Normalizes a set of tags for storage: lowercase, trimmed, deduplicated. */
export function encodeTags(list) {
  const out = [];
  for (const raw of (Array.isArray(list) ? list : parseTags(list))) {
    const t = String(raw || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 24);
    if (t && !out.includes(t)) out.push(t);
  }
  return out.join(',');
}

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

/**
 * The shop's listings for a set of names, keyed by the LOWERED name.
 *
 * One query for the whole set rather than one per name. A delivery, a haul and
 * a crate each need the same three answers about every line they carry — what
 * the shop already calls it, what it charges, how many it holds — and asking
 * them item by item is a round trip per line for no reason. Ten items in a
 * crate was ten sequential reads before this.
 *
 * Matched on the lowered name because the inventory's uniqueness is on the raw
 * one: "iron sword" and "Iron Sword" are two rows to SQLite, and a line typed
 * in either case has to find the listing it means.
 */
export async function listingsByName(db, realmId, business, names) {
  const keys = [...new Set((names || []).map((n) => String(n || '').trim().toLowerCase()).filter(Boolean))];
  if (!keys.length) return new Map();
  const { results } = await db.prepare(
    'SELECT item, price, stock, harvest_pay FROM inventory WHERE realm_id = ? AND business = ? ' +
    'AND lower(item) IN (' + keys.map(() => '?').join(', ') + ')')
    .bind(realmId, business, ...keys).all();
  return new Map((results || []).map((r) => [String(r.item).toLowerCase(), r]));
}

/** Every item for a business, ordered by name. */
export async function listInventory(env, business, realmId) {
  const db = await getDb(env);
  const { results } = await db
    .prepare('SELECT item, price, stock, low_stock, ingredient, harvest_pay, tags FROM inventory WHERE realm_id = ? AND business = ? ORDER BY item COLLATE NOCASE')
    .bind(realmId, business)
    .all();
  /**
   * What this shop has actually PAID per unit, averaged over its own deliveries.
   *
   * An ingredient is never sold, so its sale price says nothing about it — the
   * number somebody restocking needs is what it costs. Weighted by quantity
   * (SUM of spend ÷ SUM of units), so one small emergency purchase at a bad
   * price does not become the figure. Harvested stock is excluded: it cost
   * nothing, and counting it would drag the average toward zero and suggest
   * ingredients are cheaper to buy than they are.
   */
  const { results: costs } = await db.prepare(
    `SELECT item, SUM(num_items * price_per) AS spend, SUM(num_items) AS units
       FROM intake WHERE realm_id = ? AND business = ? AND price_per > 0
      GROUP BY lower(item)`).bind(realmId, business).all();
  const avgByName = new Map((costs || [])
    .filter((c) => Number(c.units) > 0)
    .map((c) => [String(c.item).toLowerCase(), Number(c.spend) / Number(c.units)]));

  return (results || []).map((r) => ({
    item: r.item,
    price: r.price,
    stock: r.stock,
    lowStock: r.low_stock,
    // Stock held to craft with, not to sell. A property of THIS shop's listing:
    // one shop's ingredient is another's stock-in-trade, so it could never live
    // on the shared item index.
    ingredient: !!r.ingredient,
    // What the shop pays one of its own for bringing this in, per unit. 0 is
    // "not paid for", and the Harvest side of the register offers payment only
    // where this is set.
    harvestPay: Number(r.harvest_pay) || 0,
    // What KIND of thing this is, lowercase. A special can ask for five of a
    // kind rather than naming five items, which is why these are worth storing
    // at all.
    tags: parseTags(r.tags),
    // Null rather than 0 when nothing has ever been bought — "no data" and
    // "free" are different answers and the UI shows only one of them.
    avgCost: avgByName.has(String(r.item).toLowerCase())
      ? Math.round(avgByName.get(String(r.item).toLowerCase()) * 100) / 100
      : null,
    status: statusFor(r.stock, r.low_stock),
  }));
}

/**
 * Adds or updates an item's DETAILS (sale price + low-stock threshold). Stock is
 * NOT set here — it's driven by intake (in) and sales (out). A brand-new item
 * starts at 0 stock; record an intake to stock it.
 */
export async function upsertItem(env, business, { item, price, lowStock, ingredient, harvestPay, tags }, realmId) {
  const db = await getDb(env);
  const name = String(item || '').trim();
  if (!name) throw new Error('Item name is required.');
  const p = Number(price);
  const l = Math.floor(Number(lowStock));
  if (!isFinite(p) || p < 0) throw new Error('Price must be a number ≥ 0.');
  const low = isFinite(l) && l > 0 ? l : 0;
  const ing = ingredient ? 1 : 0;
  // What a shop pays its own people per unit for bringing this in. Blank is
  // not 0 by accident: an omitted field keeps whatever the item already has,
  // the same rule the sale price follows on a restock.
  const payGiven = harvestPay !== undefined && harvestPay !== null && String(harvestPay).trim() !== '';
  let pay = 0;
  if (payGiven) {
    pay = Number(harvestPay);
    if (!isFinite(pay) || pay < 0) throw new Error('Harvest pay must be a number ≥ 0.');
  }
  // Tags follow the same rule: OMITTED leaves them as they are, so a screen
  // that knows nothing about kinds cannot strip a listing of what it is.
  const tagsGiven = tags !== undefined && tags !== null;
  const tagText = tagsGiven ? encodeTags(tags) : '';
  await db
    .prepare(
      `INSERT INTO inventory (realm_id, business, item, price, stock, low_stock, ingredient, harvest_pay, tags)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
       ON CONFLICT (realm_id, business, item)
       DO UPDATE SET price = excluded.price, low_stock = excluded.low_stock, ingredient = excluded.ingredient,
         harvest_pay = CASE WHEN ? THEN excluded.harvest_pay ELSE inventory.harvest_pay END,
         tags = CASE WHEN ? THEN excluded.tags ELSE inventory.tags END`
    )
    .bind(realmId, business, name, p, low, ing, pay, tagText, payGiven ? 1 : 0, tagsGiven ? 1 : 0)
    .run();
  return listInventory(env, business, realmId);
}

/**
 * Sets an item's stock BY HAND — a stocktake, breakage, spoilage, a delivery
 * that arrived short, or simply a number that drifted.
 *
 * Everything else moves stock as a side effect of something that happened:
 * intake adds, sales subtract, crafting does both. Those are the honest paths
 * and this does not replace them — it exists because the shelf is the real
 * authority, and when the count on it disagrees with the count in here, the
 * shelf wins. Without this the only way to fix a wrong number was to invent an
 * intake, which put money through the coffer that nobody spent.
 *
 * So: the stock changes and NOTHING ELSE does. No coffer entry, because no gold
 * moved. The audit trail is where it is explained — a correction with no record
 * of who made it is indistinguishable from a bug.
 */
export async function setStock(env, business, { item, stock, note }, realmId) {
  const db = await getDb(env);
  const name = String(item || '').trim();
  if (!name) throw new Error('Which item?');
  const n = Math.floor(Number(stock));
  if (!isFinite(n) || n < 0) throw new Error('Stock must be a whole number, 0 or more.');

  const row = await db.prepare(
    'SELECT item, stock FROM inventory WHERE realm_id = ? AND business = ? AND lower(item) = ?')
    .bind(realmId, business, name.toLowerCase()).first();
  // Only an item the shop already lists. Creating one here would make a stock
  // count a way to invent inventory, bypassing the index the register picks from.
  if (!row) throw new Error('"' + name + '" is not in your inventory. Record an intake to stock it first.');

  await db.prepare('UPDATE inventory SET stock = ? WHERE realm_id = ? AND business = ? AND item = ?')
    .bind(n, realmId, business, row.item).run();

  return { was: row.stock, now: n, item: row.item, note: String(note || '').trim().slice(0, 200) };
}

/**
 * Sets ONE tag across the whole shop: here is everything that is food.
 *
 * Tagging is a question about a LIST — "which of these are drink?" — and asking
 * it item by item means opening forty modals to answer it once. So this takes
 * the tag and the items that carry it, and the items NOT named have it taken
 * off: what comes back is the answer to the question, not an addition to it.
 * Every other tag on every row is left exactly as it was, so answering about
 * drink cannot disturb what is food.
 *
 * One batch, so a shop is never half-tagged.
 */
export async function setItemTag(env, business, { tag, items }, realmId) {
  const db = await getDb(env);
  const key = encodeTags([tag]);
  if (!key) throw new Error('Which kind of item?');
  if (key.includes(',')) throw new Error('One kind at a time.');

  const wanted = new Set((Array.isArray(items) ? items : [])
    .map((i) => String(i || '').trim().toLowerCase())
    .filter(Boolean));

  const { results } = await db.prepare('SELECT item, tags FROM inventory WHERE realm_id = ? AND business = ?')
    .bind(realmId, business).all();

  const writes = [];
  for (const row of (results || [])) {
    const has = parseTags(row.tags);
    const should = wanted.has(String(row.item).toLowerCase());
    const now = has.includes(key);
    if (should === now) continue; // nothing to say about this row
    const next = should ? [...has, key] : has.filter((t) => t !== key);
    writes.push(db.prepare('UPDATE inventory SET tags = ? WHERE realm_id = ? AND business = ? AND item = ?')
      .bind(encodeTags(next), realmId, business, row.item));
  }
  if (writes.length) await db.batch(writes);
  return listInventory(env, business, realmId);
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

/**
 * Crafting: turns stock of one or more INGREDIENTS into stock of an OUTPUT.
 *
 * The ingredients are consumed and the output appears, in one atomic batch, so
 * a half-applied craft can never leave a shop short of both. No money moves —
 * nothing was bought or sold, and writing an intake row (the obvious shortcut
 * for "stock appeared") would put a fabricated purchase price into Market
 * Analysis's buy side and quietly corrupt what items are worth.
 *
 * The output is canonicalized against the master index for the same reason the
 * register is: an item invented at the crafting bench would fragment the index.
 * A shop that does not yet stock the output gets the row created, priced at the
 * item's base value — the same rule intake uses for a first delivery.
 */
export async function convertItems(env, business, { inputs, output, idempotencyKey }, realmId) {
  const db = await getDb(env);
  // Idempotency: a craft that succeeded but whose response was lost must not
  // consume the ingredients twice on retry. There is no craft table to carry a
  // key, so it lives in sys_flags — scoped to the realm and shop, since two
  // shops' keys are unrelated.
  const idem = String(idempotencyKey || '').trim();
  const idemKey = idem ? 'craft:' + realmId + ':' + business + ':' + idem : '';
  if (idemKey && await getFlag(env, idemKey)) {
    return { ok: true, duplicate: true, inventory: await listInventory(env, business, realmId) };
  }

  const outName = String((output && output.item) || '').trim();
  const outQty = Math.floor(Number(output && output.qty));
  if (!outName) throw new Error('Pick what you are making.');
  if (!isFinite(outQty) || outQty < 1) throw new Error('How many are you making? Enter a whole number ≥ 1.');

  // Fold repeats before checking stock: two rows of the same ingredient are one
  // demand on that item, and checking them separately would let a craft through
  // that needs more than the shop has.
  const need = new Map();
  (inputs || []).forEach((i) => {
    const name = String((i && i.item) || '').trim();
    const qty = Math.floor(Number(i && i.qty));
    if (!name) return;
    if (!isFinite(qty) || qty < 1) throw new Error('Each ingredient needs a whole quantity ≥ 1.');
    need.set(name.toLowerCase(), { item: name, qty: (need.get(name.toLowerCase()) || { qty: 0 }).qty + qty });
  });
  if (!need.size) throw new Error('Add at least one ingredient.');

  const master = await listItemIndex(env, realmId);
  const canonOut = matchMasterItem(outName, master);
  if (!canonOut) throw new Error('"' + outName + '" is not in the item index — an admin must add it first.');
  if (need.has(canonOut.name.toLowerCase())) {
    throw new Error('An item cannot be its own ingredient.');
  }

  const { results } = await db.prepare('SELECT item, price, stock FROM inventory WHERE realm_id = ? AND business = ?')
    .bind(realmId, business).all();
  const inv = new Map((results || []).map((r) => [String(r.item).toLowerCase(), r]));

  const stmts = [];
  const used = [];
  for (const [key, want] of need) {
    const have = inv.get(key);
    if (!have) throw new Error('You have no ' + want.item + ' in stock.');
    if (have.stock < want.qty) {
      throw new Error('Not enough ' + have.item + ' — you have ' + have.stock + ', this needs ' + want.qty + '.');
    }
    used.push(have.item + ' ×' + want.qty);
    stmts.push(db.prepare('UPDATE inventory SET stock = stock - ? WHERE realm_id = ? AND business = ? AND item = ?')
      .bind(want.qty, realmId, business, have.item));
  }
  stmts.push(db.prepare(
    `INSERT INTO inventory (realm_id, business, item, price, stock, low_stock) VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT (realm_id, business, item) DO UPDATE SET stock = stock + excluded.stock`)
    .bind(realmId, business, canonOut.name, canonOut.baseValue || 0, outQty));
  await db.batch(stmts);
  if (idemKey) await setFlag(env, idemKey, ts());

  return {
    ok: true,
    made: { item: canonOut.name, qty: outQty },
    used: [...need.values()].map((w) => ({ item: w.item, qty: w.qty })),
    detail: used.join(', ') + ' → ' + canonOut.name + ' ×' + outQty,
    inventory: await listInventory(env, business, realmId),
  };
}

/* ---- stock counts as plain text ---- */

/**
 * A stocktake, as text you can read: one `Name, Amount` line per item.
 *
 * Deliberately NAME AND COUNT ONLY. The old bulk import carried price, stock
 * and the low-stock mark on every line, which made a paste into it able to
 * rewrite every price a shop charged — that is why it was shelved (see
 * `archive/inventory-import/`). Counting stock and pricing stock are different
 * jobs, and this one only does the first: an import through here can move a
 * count and can do nothing else whatever a line says.
 */
export async function stockText(env, business, realmId) {
  const rows = await listInventory(env, business, realmId);
  return rows.map((r) => r.item + ', ' + Math.floor(Number(r.stock) || 0)).join('\n');
}

/**
 * Reads a pasted stocktake and works out what it would DO — without doing it.
 *
 * ONE planner for the preview and for the apply. They were separate functions
 * in the shelved import, which is how a preview can promise one thing and the
 * apply perform another; here the preview is literally the apply with the last
 * step left off, so they cannot drift.
 *
 * The amount is the LAST number on the line, so an item whose name contains a
 * comma still parses.
 *
 * A NAME THE SHOP DOES NOT STOCK IS ADDED. A stocktake is a count of what is
 * actually on the shelves, and finding something there that was never listed is
 * an ordinary outcome of counting — reporting it and walking away left the
 * owner with a list of things to go and type in by hand. What it CANNOT do is
 * make up a price: a new listing takes its price from the master index if the
 * item is known there, and 0 if it is not, for an owner to set. It still cannot
 * touch the price of an item that already exists.
 *
 * An item the master index has never heard of is flagged `pending` when it is
 * applied — the same thing the register does when a clerk sells something
 * unlisted, and for the same reason: the usual cause is a near-duplicate of
 * something already there, and a person has to look.
 */
export function planStockImport(text, inventory, master) {
  const have = new Map();
  (inventory || []).forEach((r) => have.set(String(r.item).trim().toLowerCase(), r));
  const index = new Map();
  (master || []).forEach((m) => index.set(normalizeItem(m.name), m));

  // Keyed by item, not appended, so the SAME item named twice resolves to ONE
  // outcome — the last line. Appending gave a plan with two rows for it and an
  // "applied" count that double-counted; the writes happened to land on the
  // right number, so the only thing wrong was what the preview promised, which
  // is the one thing a preview has to get right.
  const decided = new Map();
  const invalid = [];
  const seen = new Set();

  String(text || '').split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    // A pasted spreadsheet usually brings its header with it. It parses as a
    // line with no number, so it lands in `invalid` and says so rather than
    // being silently dropped — but a first line that is exactly the header this
    // export writes is a header, not a mistake.
    if (i === 0 && /^\s*(item|name)\s*,?\s*(amount|qty|quantity|stock)?\s*$/i.test(line)) return;

    const m = line.match(/^(.*?)[,\s]+(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) { invalid.push({ line, why: 'no amount on this line' }); return; }
    const name = m[1].trim().replace(/,$/, '').trim();
    const n = Math.floor(Number(m[2]));
    if (!name) { invalid.push({ line, why: 'no item name' }); return; }
    if (!isFinite(n) || n < 0) { invalid.push({ line, why: 'an amount cannot be negative' }); return; }

    const key = name.toLowerCase();
    // The same item twice in one paste: the last line wins, and both are shown
    // so nobody is surprised by which.
    if (seen.has(key)) invalid.push({ line, why: 'listed more than once — the last one wins' });
    seen.add(key);

    const row = have.get(key);
    if (row) {
      decided.set(key, { kind: 'set', item: row.item, was: Math.floor(Number(row.stock) || 0), now: n });
      return;
    }
    // Not stocked. Take the master index's spelling and base value where it
    // knows the item, so a new listing joins the index rather than sitting
    // beside it under a slightly different name.
    const known = index.get(normalizeItem(name)) || null;
    decided.set(key, {
      kind: 'add',
      item: known ? known.name : name,
      stock: n,
      price: known ? Number(known.baseValue) || 0 : 0,
      known: !!known,
    });
  });

  const changes = [];
  const unchanged = [];
  const creates = [];
  decided.forEach((d) => {
    if (d.kind === 'add') { creates.push({ item: d.item, stock: d.stock, price: d.price, known: d.known }); return; }
    if (d.was === d.now) unchanged.push({ item: d.item, stock: d.now });
    else changes.push({ item: d.item, was: d.was, now: d.now, delta: d.now - d.was });
  });

  // What the paste did NOT mention. Left exactly as it is — a stocktake of the
  // back room is not a claim that everything else is gone, and a partial list
  // silently zeroing the rest is the worst thing this could do.
  const untouched = (inventory || []).filter((r) => !seen.has(String(r.item).trim().toLowerCase())).length;

  return { changes, unchanged, creates, invalid, untouched };
}

/**
 * Applies a pasted stocktake: sets counts, adds listings it found on the
 * shelves, and touches nothing else.
 *
 * Every line is planned before any is written and the writes go in one
 * `db.batch`, so a stocktake lands whole or not at all — the same rule a
 * delivery follows.
 *
 * An added listing takes its price from the master index, or 0 when the index
 * has never heard of it. It CANNOT change the price of a listing that already
 * exists: that is the line this whole shape was drawn around.
 */
export async function importStockText(env, business, text, realmId, actor) {
  const [inventory, master] = await Promise.all([
    listInventory(env, business, realmId),
    listItemIndex(env, realmId),
  ]);
  const plan = planStockImport(text, inventory, master);
  if (!plan.changes.length && !plan.creates.length) return { ...plan, applied: 0, added: 0, inventory };

  const db = await getDb(env);
  const stmts = plan.changes.map((c) => db.prepare(
    'UPDATE inventory SET stock = ? WHERE realm_id = ? AND business = ? AND item = ?')
    .bind(c.now, realmId, business, c.item));
  // ON CONFLICT DO NOTHING rather than an upsert: if the row somehow exists by
  // the time this runs, the paste must still not move its price.
  plan.creates.forEach((c) => stmts.push(db.prepare(
    `INSERT INTO inventory (realm_id, business, item, price, stock, low_stock)
     VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT (realm_id, business, item) DO NOTHING`)
    .bind(realmId, business, c.item, c.price, c.stock)));
  await db.batch(stmts);

  // Anything the realm's index has never seen goes in flagged, exactly as the
  // register does when a clerk sells something unlisted. Held up for an admin
  // because the usual cause is a near-duplicate under a different spelling.
  for (const c of plan.creates) {
    if (!c.known) await notePendingItem(env, { name: c.item, baseValue: 0, by: actor || '', shop: business }, realmId);
  }

  return {
    ...plan,
    applied: plan.changes.length,
    added: plan.creates.length,
    inventory: await listInventory(env, business, realmId),
  };
}
