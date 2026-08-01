/** Reusable named discounts per shop (D1). Used to fill the register's discount. */
import { getDb } from './db.js';

export async function listDiscounts(env, business, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    'SELECT id, name, percent FROM discounts WHERE business = ? AND realm_id = ? ORDER BY name').bind(business, realmId).all();
  return results || [];
}

export async function addDiscount(env, business, { name, percent }, realmId) {
  const nm = String(name || '').trim();
  const pct = Number(percent);
  if (!nm) throw new Error('Enter a discount name.');
  if (!isFinite(pct) || pct <= 0 || pct > 100) throw new Error('Percent must be between 1 and 100.');
  const db = await getDb(env);
  try {
    await db.prepare('INSERT INTO discounts (realm_id, business, name, percent) VALUES (?, ?, ?, ?)').bind(realmId, business, nm, pct).run();
  } catch (e) {
    throw new Error('A discount named "' + nm + '" already exists.');
  }
  return listDiscounts(env, business, realmId);
}

export async function deleteDiscount(env, business, id, realmId) {
  const db = await getDb(env);
  await db.prepare('DELETE FROM discounts WHERE business = ? AND id = ? AND realm_id = ?').bind(business, Number(id), realmId).run();
  return listDiscounts(env, business, realmId);
}
