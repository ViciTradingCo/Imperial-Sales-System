/**
 * Reusable named price ADJUSTMENTS per shop (D1) — discounts and upcharges.
 *
 * ONE SIGNED PERCENT, not two kinds of row. A positive `percent` takes money
 * off; a negative one puts money on. Everything downstream is then the same
 * arithmetic — `total × (100 − percent) ÷ 100` — which is the point: a second
 * kind of row would mean a second path through checkout, the sales log, the
 * offline queue and the Court's levy, and an upcharge that some one of them
 * forgot about would be an upcharge that silently did not happen.
 *
 * The SIGN IS STORAGE, never wording. "15% surcharge" is a −15 row shown
 * through `adjustmentLabel`; nothing writes the words "discount" or "surcharge"
 * into the database. Same rule the rest of the ledger follows.
 */
import { getDb } from './db.js';

/** The furthest an upcharge may go: ten times the asking price. */
export const MAX_UPCHARGE = 1000;

/**
 * How an adjustment is written on screen and stamped on a sale.
 *
 * Takes the signed percent and gives back the words, so the register, the sales
 * log and the shop's own settings cannot describe the same row differently.
 */
export function adjustmentLabel(percent, name) {
  const pct = Number(percent) || 0;
  if (!pct) return '';
  const word = pct < 0 ? '% surcharge' : '%';
  const nm = String(name || '').trim();
  return (nm ? nm + ' ' : '') + '(' + Math.abs(pct) + word + ')';
}

export async function listDiscounts(env, business, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    'SELECT id, name, percent FROM discounts WHERE business = ? AND realm_id = ? ORDER BY name').bind(business, realmId).all();
  // `percent` stays SIGNED on the way out. The client needs the sign to render
  // it and to send it back; handing over an absolute value plus a flag would
  // give two things that can disagree.
  return (results || []).map((r) => ({ ...r, percent: Number(r.percent) || 0 }));
}

export async function addDiscount(env, business, { name, percent }, realmId) {
  const nm = String(name || '').trim();
  const pct = Number(percent);
  if (!nm) throw new Error('Enter a name.');
  if (!isFinite(pct) || pct === 0) throw new Error('Enter a percentage — off for a discount, on for an upcharge.');
  // A discount cannot take more than the whole price; an upcharge has no such
  // natural limit, so it gets a stated one instead of none at all.
  if (pct > 100) throw new Error('A discount cannot be more than 100%.');
  if (pct < -MAX_UPCHARGE) throw new Error('An upcharge cannot be more than ' + MAX_UPCHARGE + '%.');
  const db = await getDb(env);
  try {
    await db.prepare('INSERT INTO discounts (realm_id, business, name, percent) VALUES (?, ?, ?, ?)').bind(realmId, business, nm, pct).run();
  } catch (e) {
    throw new Error('A discount or upcharge named "' + nm + '" already exists.');
  }
  return listDiscounts(env, business, realmId);
}

export async function deleteDiscount(env, business, id, realmId) {
  const db = await getDb(env);
  await db.prepare('DELETE FROM discounts WHERE business = ? AND id = ? AND realm_id = ?').bind(business, Number(id), realmId).run();
  return listDiscounts(env, business, realmId);
}
