/**
 * Public shop storefronts — a read-only per-shop catalog anyone can view (no
 * sign-in). Gated behind an admin feature flag (sys_flags 'storefronts_enabled')
 * so the app can ship with it OFF and be repurposed per deployment.
 */
import { getDb, getFlag, setFlag } from './db.js';
import { getShopStyle } from './shop-style.js';

export const STOREFRONT_FLAG = 'storefronts_enabled';

export async function storefrontsEnabled(env) {
  return (await getFlag(env, STOREFRONT_FLAG)) === '1';
}
export async function setStorefrontsEnabled(env, on) {
  await setFlag(env, STOREFRONT_FLAG, on ? '1' : '0');
  return !!on;
}

/** The public catalog for one active shop. Throws if storefronts are off or the shop isn't found. */
export async function publicStorefront(env, business) {
  if (!(await storefrontsEnabled(env))) {
    const e = new Error('Public storefronts are not enabled.');
    e.forbidden = true; throw e;
  }
  const db = await getDb(env);
  const target = String(business || '').trim().toLowerCase();
  const co = await db.prepare("SELECT business FROM companies WHERE lower(business) = ? AND upper(status) != 'ARCHIVED'")
    .bind(target).first();
  if (!co) throw new Error('Shop not found.');
  const style = await getShopStyle(env, co.business);
  const { results } = await db.prepare('SELECT item, price, stock, low_stock FROM inventory WHERE business = ? ORDER BY item COLLATE NOCASE')
    .bind(co.business).all();
  const items = (results || []).map((r) => ({
    item: r.item,
    price: r.price,
    status: r.stock <= 0 ? 'Out of Stock' : (r.low_stock > 0 && r.stock <= r.low_stock ? 'Low' : 'In Stock'),
  }));
  return { business: co.business, tagline: style.tagline || '', accent: style.accent || '', items };
}
