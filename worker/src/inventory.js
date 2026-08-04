/**
 * Inventory operations (D1). Each row belongs to one business. The rep-facing
 * "Status" (In Stock / Low / Out of Stock) is derived from the per-item manual
 * Low Stock threshold, matching the original ledger's behavior.
 */
import { getDb, getFlag, setFlag } from './db.js';
import { listItemIndex, matchMasterItem } from './item-index.js';

const ts = () => new Date().toISOString();

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
    .prepare('SELECT item, price, stock, low_stock, ingredient FROM inventory WHERE realm_id = ? AND business = ? ORDER BY item COLLATE NOCASE')
    .bind(realmId, business)
    .all();
  return (results || []).map((r) => ({
    item: r.item,
    price: r.price,
    stock: r.stock,
    lowStock: r.low_stock,
    // Stock held to craft with, not to sell. A property of THIS shop's listing:
    // one shop's ingredient is another's stock-in-trade, so it could never live
    // on the shared item index.
    ingredient: !!r.ingredient,
    status: statusFor(r.stock, r.low_stock),
  }));
}

/**
 * Adds or updates an item's DETAILS (sale price + low-stock threshold). Stock is
 * NOT set here — it's driven by intake (in) and sales (out). A brand-new item
 * starts at 0 stock; record an intake to stock it.
 */
export async function upsertItem(env, business, { item, price, lowStock, ingredient }, realmId) {
  const db = await getDb(env);
  const name = String(item || '').trim();
  if (!name) throw new Error('Item name is required.');
  const p = Number(price);
  const l = Math.floor(Number(lowStock));
  if (!isFinite(p) || p < 0) throw new Error('Price must be a number ≥ 0.');
  const low = isFinite(l) && l > 0 ? l : 0;
  const ing = ingredient ? 1 : 0;
  await db
    .prepare(
      `INSERT INTO inventory (realm_id, business, item, price, stock, low_stock, ingredient)
       VALUES (?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT (realm_id, business, item)
       DO UPDATE SET price = excluded.price, low_stock = excluded.low_stock, ingredient = excluded.ingredient`
    )
    .bind(realmId, business, name, p, low, ing)
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
