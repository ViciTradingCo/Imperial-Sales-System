/**
 * BUNDLES — several items sold together for one price.
 *
 * "Five ales and five stews, sixty gold." The price is the BUNDLE'S, not the sum
 * of what its parts cost separately; that difference is the whole reason a shop
 * offers one, and it is why a bundle is a thing in its own right rather than a
 * discount with a shopping list attached.
 *
 * IT IS ONE LINE AT THE REGISTER, not a shortcut that types several. The parts
 * still come out of stock — every one of them — but the cart carries the bundle,
 * priced once. Expanding it into its parts at the till would have meant either
 * inventing a per-item price for each (which is a lie about what those items are
 * worth, and one the market analysis would have believed) or leaving the total
 * disagreeing with the lines.
 *
 * THE PRICE IS NEVER SENT BY THE CLIENT. The register names a bundle; the Worker
 * looks up what it costs. Same rule as the harvest rate and the commission
 * percentage — the person at the till must not be able to name their own price.
 */
import { getDb } from './db.js';

/** How many distinct items one bundle may hold. A guard against a paste, not a design limit. */
const MAX_PARTS = 40;

function rowToBundle(r) {
  let parts = [];
  try {
    const raw = JSON.parse(r.parts || '[]');
    if (Array.isArray(raw)) {
      parts = raw
        .map((p) => ({ item: String((p && p.item) || '').trim(), qty: Math.floor(Number(p && p.qty)) || 0 }))
        .filter((p) => p.item && p.qty > 0);
    }
  } catch (e) { /* a malformed row reads as an empty bundle rather than throwing */ }
  return {
    id: r.id,
    name: String(r.name || '').trim(),
    price: Number(r.price) || 0,
    parts,
    // What the parts would come to if they were rung up separately. Worked out
    // where it is DISPLAYED rather than stored, because it moves whenever a
    // price does — a saved "was 75gp" would start lying the first time somebody
    // repriced an ale.
    units: parts.reduce((n, p) => n + p.qty, 0),
  };
}

export async function listBundles(env, business, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    'SELECT id, name, price, parts FROM bundles WHERE business = ? AND realm_id = ? ORDER BY name')
    .bind(business, realmId).all();
  return (results || []).map(rowToBundle);
}

/** One bundle by name, case-insensitively — what checkout resolves against. */
export async function findBundle(env, business, name, realmId) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return null;
  const db = await getDb(env);
  const r = await db.prepare(
    'SELECT id, name, price, parts FROM bundles WHERE business = ? AND realm_id = ? AND lower(name) = ?')
    .bind(business, realmId, target).first();
  return r ? rowToBundle(r) : null;
}

/**
 * Creates or replaces a bundle.
 *
 * Replaces rather than refusing a duplicate name: a bundle is a thing a shop
 * TUNES — the price of the Friday deal changes, an item joins it — and making
 * that delete-then-recreate would mean the register briefly offering neither.
 */
export async function saveBundle(env, business, { name, price, parts }, realmId) {
  const nm = String(name || '').trim();
  if (!nm) throw new Error('Give the bundle a name.');
  const p = Number(price);
  if (!isFinite(p) || p < 0) throw new Error('A bundle price must be a number, 0 or more.');

  const clean = [];
  const seen = new Set();
  for (const raw of (Array.isArray(parts) ? parts : [])) {
    const item = String((raw && raw.item) || '').trim();
    const qty = Math.floor(Number(raw && raw.qty));
    if (!item) continue;
    if (!isFinite(qty) || qty < 1) throw new Error('Each item in a bundle needs a quantity of 1 or more.');
    const key = item.toLowerCase();
    // The same item twice would work — the quantities would add — but it reads
    // as a mistake and hides one of the two lines, so it is refused.
    if (seen.has(key)) throw new Error('"' + item + '" is in this bundle twice. Put it in once with the full quantity.');
    seen.add(key);
    clean.push({ item, qty });
  }
  if (!clean.length) throw new Error('A bundle needs at least one item in it.');
  if (clean.length > MAX_PARTS) throw new Error('A bundle can hold at most ' + MAX_PARTS + ' different items.');

  const db = await getDb(env);
  await db.prepare(
    `INSERT INTO bundles (realm_id, business, name, price, parts) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (realm_id, business, name) DO UPDATE SET price = excluded.price, parts = excluded.parts`)
    .bind(realmId, business, nm, p, JSON.stringify(clean)).run();
  return listBundles(env, business, realmId);
}

export async function deleteBundle(env, business, id, realmId) {
  const db = await getDb(env);
  await db.prepare('DELETE FROM bundles WHERE business = ? AND id = ? AND realm_id = ?')
    .bind(business, Number(id), realmId).run();
  return listBundles(env, business, realmId);
}
