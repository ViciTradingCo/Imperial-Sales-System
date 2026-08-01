/** Per-shop style — a tagline and accent colour shown on the shop's register. */
import { getDb } from './db.js';

const HEX = /^#[0-9a-fA-F]{6}$/;

export async function getShopStyle(env, business, realmId) {
  const db = await getDb(env);
  const r = await db.prepare('SELECT tagline, accent FROM shop_style WHERE business = ? AND realm_id = ?')
    .bind(business, realmId).first();
  return { tagline: (r && r.tagline) || '', accent: (r && r.accent) || '' };
}

export async function setShopStyle(env, business, { tagline, accent }, realmId) {
  const acc = String(accent || '').trim();
  const db = await getDb(env);
  await db.prepare(
    `INSERT INTO shop_style (realm_id, business, tagline, accent) VALUES (?, ?, ?, ?)
     ON CONFLICT(realm_id, business) DO UPDATE SET tagline = excluded.tagline, accent = excluded.accent`)
    .bind(realmId, business, String(tagline || '').trim().slice(0, 120), HEX.test(acc) ? acc : '').run();
  return getShopStyle(env, business, realmId);
}
