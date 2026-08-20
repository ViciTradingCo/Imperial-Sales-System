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
 *
 * A SPECIAL MAY ASK FOR KINDS INSTEAD OF ITEMS — "five food and five drink for
 * forty" — which is a different deal from a fixed set: the customer chooses
 * what fills it. Then the special carries the REQUIREMENT (`needs`) and the
 * till carries the CHOICE, which the Worker checks against the tags on the
 * shop's own listings before it prices anything. A row has parts or needs and
 * never both; a special written before any of this has parts, and an empty
 * `needs` is what says so.
 */
import { getDb } from './db.js';
import { encodeTags } from './inventory.js';

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
  let needs = [];
  try {
    const raw = JSON.parse(r.needs || '[]');
    if (Array.isArray(raw)) {
      needs = raw
        .map((n) => ({ tag: String((n && n.tag) || '').trim().toLowerCase(), qty: Math.floor(Number(n && n.qty)) || 0 }))
        .filter((n) => n.tag && n.qty > 0);
    }
  } catch (e) { /* as above: unreadable reads as none */ }
  return {
    id: r.id,
    name: String(r.name || '').trim(),
    price: Number(r.price) || 0,
    /**
     * PRICED AS A PERCENTAGE OFF ITS OWN ITEMS, when this is set — a suit of
     * armour at 10% off the armour. It is not the order-level discount: it
     * touches only what is in this special, and the rest of the sale is rung
     * up at full price beside it.
     *
     * 0 means the flat `price` above is what it costs, which is every special
     * written before this existed. One or the other, never both — a deal
     * cannot be 60 gold AND 10% off without one of the two being a lie.
     */
    percentOff: Number(r.discount_pct) || 0,
    parts,
    /**
     * WHAT IT ASKS FOR, when it does not name items: [{tag, qty}] — five food
     * and five drink. The customer chooses which at the till, so the special
     * carries the requirement and the SALE carries what was actually taken.
     *
     * A special has parts or needs, never both. Two ways of saying what is in
     * one deal is two things to keep agreeing with each other.
     */
    needs,
    // What the parts would come to if they were rung up separately. Worked out
    // where it is DISPLAYED rather than stored, because it moves whenever a
    // price does — a saved "was 75gp" would start lying the first time somebody
    // repriced an ale.
    units: needs.length
      ? needs.reduce((n, p) => n + p.qty, 0)
      : parts.reduce((n, p) => n + p.qty, 0),
  };
}

export async function listBundles(env, business, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    'SELECT id, name, price, parts, needs, discount_pct FROM bundles WHERE business = ? AND realm_id = ? ORDER BY name')
    .bind(business, realmId).all();
  return (results || []).map(rowToBundle);
}

/** One bundle by name, case-insensitively — what checkout resolves against. */
export async function findBundle(env, business, name, realmId) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return null;
  const db = await getDb(env);
  const r = await db.prepare(
    'SELECT id, name, price, parts, needs, discount_pct FROM bundles WHERE business = ? AND realm_id = ? AND lower(name) = ?')
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
export async function saveBundle(env, business, { name, price, parts, needs, percentOff }, realmId) {
  const nm = String(name || '').trim();
  if (!nm) throw new Error('Give the bundle a name.');

  /**
   * TWO WAYS TO PRICE ONE, and it is one or the other.
   *
   * A flat figure for the lot, or a percentage off what the shop already
   * charges for the things in it. A percentage is not an upcharge in disguise:
   * a set worth MORE than its parts is what the flat price is for, so this is
   * held to 0–100 rather than made signed the way the order-level adjustment is.
   */
  const off = Number(percentOff) || 0;
  if (!isFinite(off) || off < 0 || off > 100) {
    throw new Error('A special’s discount must be between 0 and 100 percent.');
  }
  const p = off ? 0 : Number(price);
  if (!off && (!isFinite(p) || p < 0)) throw new Error('A bundle price must be a number, 0 or more.');

  /**
   * BY TAG: "five food and five drink". It names no items, so the till chooses
   * them and the Worker checks the choice against this when the sale is rung
   * up — the same division of labour as the bundle price itself.
   */
  const wants = [];
  const tagSeen = new Set();
  for (const raw of (Array.isArray(needs) ? needs : [])) {
    const tag = encodeTags([(raw && raw.tag) || '']);
    const qty = Math.floor(Number(raw && raw.qty));
    if (!tag) continue;
    if (!isFinite(qty) || qty < 1) throw new Error('Each kind in a special needs a quantity of 1 or more.');
    if (tagSeen.has(tag)) throw new Error('"' + tag + '" is asked for twice. Ask for it once, with the full number.');
    tagSeen.add(tag);
    wants.push({ tag, qty });
  }
  if (wants.length > MAX_PARTS) throw new Error('A special can ask for at most ' + MAX_PARTS + ' kinds.');

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
  // ONE WAY OR THE OTHER. A special that both named items and asked for kinds
  // would have to be reconciled at the till, and there is no honest answer to
  // "five drink, one of which is this ale" that is not simply one of the two.
  if (clean.length && wants.length) {
    throw new Error('A special either names its items or asks for kinds of item — not both.');
  }
  if (!clean.length && !wants.length) throw new Error('A bundle needs at least one item in it.');
  if (clean.length > MAX_PARTS) throw new Error('A bundle can hold at most ' + MAX_PARTS + ' different items.');

  const db = await getDb(env);
  await db.prepare(
    `INSERT INTO bundles (realm_id, business, name, price, parts, needs, discount_pct) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (realm_id, business, name)
     DO UPDATE SET price = excluded.price, parts = excluded.parts, needs = excluded.needs,
       discount_pct = excluded.discount_pct`)
    .bind(realmId, business, nm, p, JSON.stringify(clean), JSON.stringify(wants), off).run();
  return listBundles(env, business, realmId);
}

export async function deleteBundle(env, business, id, realmId) {
  const db = await getDb(env);
  await db.prepare('DELETE FROM bundles WHERE business = ? AND id = ? AND realm_id = ?')
    .bind(business, Number(id), realmId).run();
  return listBundles(env, business, realmId);
}
