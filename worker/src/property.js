/**
 * THE PROPERTY INDEX — a Court's register of the premises in its region.
 *
 * A Court is the region's government, and this is the part of governing that
 * decides WHO TRADES HERE. A property is a place on the Court's books; a shop
 * opens on one by redeeming the code the Court issued for it. That makes the
 * Court the gatekeeper of its own region without giving it power over anyone
 * else's — the code carries the region and the premises, and nothing else.
 *
 * A PROPERTY IS THE PLACE, NOT THE SHOP. It outlives its occupant: `business`
 * is who is there now, empty when vacant, and everything else on the row —
 * name, notes, rent — belongs to the premises and survives a tenant leaving.
 * That is why the code lives here rather than on the company: it is the right
 * to open HERE, reissuable the moment the place is empty again.
 *
 * KEYED BY REGION, like every other court table, so the premises survive a
 * Court being renamed or the flag moving to another company — see court.js.
 *
 * WHAT THIS MODULE WILL NOT DO IS MOVE MONEY. `rent` is a figure a Court
 * records, exactly as a levy is: the coin changes hands in the fiction, and the
 * app is not the party that decides it did. Same rule, stated again because the
 * temptation is the same.
 */
import { getDb } from './db.js';
import { generateCode } from './realm.js';
import { coin } from './money.js';

const key = (s) => String(s || '').trim().toLowerCase();
const genId = () => 'prp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);

function rowToProperty(r) {
  return {
    id: String(r.id || ''),
    hold: String(r.hold || ''),
    name: String(r.name || ''),
    business: String(r.business || ''),
    notes: String(r.notes || ''),
    rent: Number(r.rent) || 0,
    code: String(r.join_code || ''),
    created: String(r.created || ''),
  };
}

/**
 * Every property in a region, with its occupant.
 *
 * `vacant` is computed rather than stored, and it is not simply "business is
 * empty": a shop that has been ARCHIVED still holds the row (the rename carried
 * its new key here), and premises whose tenant has left the network are empty
 * premises. Deriving it means a restored shop is back in its own doorway with
 * nothing to repair — the same reasoning as `notArchived` in market.js.
 */
export async function listProperties(env, hold, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    `SELECT p.*, (SELECT COUNT(*) FROM companies c
                   WHERE c.realm_id = p.realm_id AND c.business = p.business
                     AND upper(COALESCE(c.status, '')) != 'ARCHIVED') AS live
       FROM property p
      WHERE p.realm_id = ? AND lower(p.hold) = ?
      ORDER BY p.name COLLATE NOCASE`).bind(realmId, key(hold)).all();
  return (results || []).map((r) => ({
    ...rowToProperty(r),
    // The name is kept even when the tenant has gone, so a Court can see who
    // was last here; `vacant` is what every decision reads.
    vacant: !r.business || !Number(r.live),
  }));
}

/** One property, by id, confined to the region asking for it. */
async function getProperty(env, id, hold, realmId) {
  const db = await getDb(env);
  const r = await db.prepare('SELECT * FROM property WHERE id = ? AND realm_id = ? AND lower(hold) = ?')
    .bind(String(id || '').trim(), realmId, key(hold)).first();
  return r ? rowToProperty(r) : null;
}

/**
 * Adds a property, or edits one. An id means edit; no id means add.
 *
 * An omitted field is LEFT ALONE rather than blanked — the same rule as
 * `upsertItem` — so a screen that only knows about rent cannot silently wipe a
 * Court's notes.
 */
export async function saveProperty(env, hold, { id, name, notes, rent }, realmId) {
  const db = await getDb(env);
  const target = String(id || '').trim();
  const current = target ? await getProperty(env, target, hold, realmId) : null;
  if (target && !current) throw new Error('That property is not in your region.');

  const nm = name === undefined ? (current ? current.name : '') : String(name || '').trim();
  if (!nm) throw new Error('Give the property a name.');
  const clash = await db.prepare(
    'SELECT id FROM property WHERE realm_id = ? AND lower(hold) = ? AND lower(name) = ?')
    .bind(realmId, key(hold), key(nm)).first();
  if (clash && clash.id !== target) {
    throw new Error('There is already a property called "' + nm + '" in your region.');
  }

  const note = notes === undefined ? (current ? current.notes : '') : String(notes || '').trim().slice(0, 1000);
  // A rent is a whole coin like every other amount — see money.js.
  const amount = rent === undefined ? (current ? current.rent : 0) : coin(Math.max(0, Number(rent) || 0));

  if (current) {
    await db.prepare('UPDATE property SET name = ?, notes = ?, rent = ? WHERE id = ? AND realm_id = ?')
      .bind(nm, note, amount, target, realmId).run();
    return getProperty(env, target, hold, realmId);
  }
  const newId = genId();
  await db.prepare(
    `INSERT INTO property (id, realm_id, hold, name, business, notes, rent, join_code, created)
     VALUES (?, ?, ?, ?, '', ?, ?, ?, ?)`)
    .bind(newId, realmId, hold, nm, note, amount, generateCode('PROP'), new Date().toISOString()).run();
  return getProperty(env, newId, hold, realmId);
}

/**
 * Removes a property from the index.
 *
 * REFUSED while somebody is trading there. Deleting occupied premises would
 * leave a shop registered in the region with nothing on the Court's books
 * saying where it is — and since a Court edits a shop THROUGH its property,
 * that shop would become unreachable. Evict first (which is a decision, and
 * should look like one), then remove the property.
 */
export async function deleteProperty(env, id, hold, realmId) {
  const p = await getProperty(env, id, hold, realmId);
  if (!p) throw new Error('That property is not in your region.');
  const live = await listProperties(env, hold, realmId);
  const row = live.find((x) => x.id === p.id);
  if (row && !row.vacant) {
    throw new Error('"' + p.name + '" is occupied by ' + p.business + '. The premises have to be empty ' +
      'before they leave the index.');
  }
  const db = await getDb(env);
  await db.prepare('DELETE FROM property WHERE id = ? AND realm_id = ?').bind(p.id, realmId).run();
  return { removed: p.name };
}

/**
 * Issues a fresh code for a property, killing the old one immediately.
 *
 * The same fix as a leaked staff code, and the same reason it is one call: the
 * only way to withdraw a code is to replace it. Refused on OCCUPIED premises —
 * a code that would put a second shop in an occupied building is a code that
 * cannot be redeemed, and handing one out is worse than refusing.
 */
export async function reissuePropertyCode(env, id, hold, realmId) {
  const rows = await listProperties(env, hold, realmId);
  const p = rows.find((x) => x.id === String(id || '').trim());
  if (!p) throw new Error('That property is not in your region.');
  if (!p.vacant) {
    throw new Error('"' + p.name + '" is occupied by ' + p.business + '. A code opens a NEW shop here, so ' +
      'the premises have to be empty first.');
  }
  const code = generateCode('PROP');
  const db = await getDb(env);
  await db.prepare('UPDATE property SET join_code = ? WHERE id = ? AND realm_id = ?')
    .bind(code, p.id, realmId).run();
  return { id: p.id, name: p.name, code };
}

/**
 * Puts a shop in a property, at sign-up.
 *
 * Conditional on the premises still being EMPTY, in the UPDATE itself rather
 * than in a check before it: two people redeeming the same code at once would
 * both pass a separate check and the second would evict the first. The write
 * that fails is the one that came second, and its caller is told so.
 */
export async function occupyProperty(env, id, business, realmId) {
  const db = await getDb(env);
  const name = String(business || '').trim();
  const target = String(id || '').trim();
  await db.prepare("UPDATE property SET business = ? WHERE id = ? AND realm_id = ? AND business = ''")
    .bind(name, target, realmId).run();
  // Confirmed by READING BACK who is there, rather than by a driver's report of
  // how many rows it changed: the answer is the same either way when the write
  // won, and a row count is the kind of detail a driver is allowed not to give.
  const row = await db.prepare('SELECT business FROM property WHERE id = ? AND realm_id = ?')
    .bind(target, realmId).first();
  if (!row) throw new Error('Those premises are no longer on the Court’s books.');
  if (String(row.business || '') !== name) {
    throw new Error('Those premises have just been taken. Ask your Court for a new code.');
  }
}

/**
 * Empties the premises a shop occupied, wherever they are.
 *
 * Called when a company is archived or closed: the shop has left, and premises
 * cannot stay let to a tenant who is gone — a Court has to be able to let them
 * again. Deliberately NOT undone by restoring, because the place may have been
 * taken in the meantime; a restored shop's Court puts it back in a doorway.
 */
export async function vacateBusiness(env, business, realmId) {
  const db = await getDb(env);
  await db.prepare("UPDATE property SET business = '' WHERE business = ? AND realm_id = ?")
    .bind(String(business || '').trim(), realmId).run();
}

/** Which property a shop occupies, if any — for the shop's own screens. */
export async function propertyOf(env, business, realmId) {
  const db = await getDb(env);
  const r = await db.prepare('SELECT * FROM property WHERE business = ? AND realm_id = ?')
    .bind(String(business || '').trim(), realmId).first();
  return r ? rowToProperty(r) : null;
}
