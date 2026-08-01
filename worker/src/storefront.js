/**
 * Public shop storefronts — a read-only per-shop catalog anyone can view (no
 * sign-in). Gated behind an admin feature flag (sys_flags 'storefronts_enabled')
 * so the app can ship with it OFF and be repurposed per deployment.
 *
 * The flag is per realm: one server can publish its shops while another keeps
 * them private. A public visitor has no identity, so the realm comes from the
 * request — and because the lookup is (realm, business), naming a shop in a
 * realm whose storefronts are off returns nothing.
 */
import { getDb, getFlag, setFlag, DEFAULT_REALM_ID } from './db.js';
import { getShopStyle } from './shop-style.js';

export const STOREFRONT_FLAG = 'storefronts_enabled';

function flagKey(realmId) {
  return STOREFRONT_FLAG + ':' + String(realmId || DEFAULT_REALM_ID);
}

export async function storefrontsEnabled(env, realmId) {
  return (await getFlag(env, flagKey(realmId))) === '1';
}
export async function setStorefrontsEnabled(env, on, realmId) {
  await setFlag(env, flagKey(realmId), on ? '1' : '0');
  return !!on;
}

/** The public catalog for one active shop. Throws if storefronts are off or the shop isn't found. */
export async function publicStorefront(env, business, realmId) {
  const realm = String(realmId || DEFAULT_REALM_ID);
  if (!(await storefrontsEnabled(env, realm))) {
    const e = new Error('Public storefronts are not enabled.');
    e.forbidden = true; throw e;
  }
  const db = await getDb(env);
  const target = String(business || '').trim().toLowerCase();
  const co = await db.prepare("SELECT business FROM companies WHERE realm_id = ? AND lower(business) = ? AND upper(status) != 'ARCHIVED'")
    .bind(realm, target).first();
  if (!co) throw new Error('Shop not found.');
  const style = await getShopStyle(env, co.business, realm);
  const { results } = await db.prepare('SELECT item, price, stock, low_stock FROM inventory WHERE realm_id = ? AND business = ? ORDER BY item COLLATE NOCASE')
    .bind(realm, co.business).all();
  const items = (results || []).map((r) => ({
    item: r.item,
    price: r.price,
    status: r.stock <= 0 ? 'Out of Stock' : (r.low_stock > 0 && r.stock <= r.low_stock ? 'Low' : 'In Stock'),
  }));
  return { business: co.business, tagline: style.tagline || '', accent: style.accent || '', items };
}
