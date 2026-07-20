/** Reusable named discounts per shop (D1). Used to fill the register's discount. */
import { getDb } from './db.js';

export async function listDiscounts(env, business) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    'SELECT id, name, percent FROM discounts WHERE business = ? ORDER BY name').bind(business).all();
  return results || [];
}

export async function addDiscount(env, business, { name, percent }) {
  const nm = String(name || '').trim();
  const pct = Number(percent);
  if (!nm) throw new Error('Enter a discount name.');
  if (!isFinite(pct) || pct <= 0 || pct > 100) throw new Error('Percent must be between 1 and 100.');
  const db = await getDb(env);
  try {
    await db.prepare('INSERT INTO discounts (business, name, percent) VALUES (?, ?, ?)').bind(business, nm, pct).run();
  } catch (e) {
    throw new Error('A discount named "' + nm + '" already exists.');
  }
  return listDiscounts(env, business);
}

export async function deleteDiscount(env, business, id) {
  const db = await getDb(env);
  await db.prepare('DELETE FROM discounts WHERE business = ? AND id = ?').bind(business, Number(id)).run();
  return listDiscounts(env, business);
}
