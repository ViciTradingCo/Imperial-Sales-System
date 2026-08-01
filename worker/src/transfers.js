/**
 * Inventory transfers between companies (D1).
 *
 * Sending a transfer removes the goods from the sender's stock immediately, but
 * they do NOT appear in the receiver's inventory until the receiver ACCEPTS —
 * at which point the stock is added to the receiver (creating the item if new).
 * Everything is done in atomic batches so stock is never double-counted.
 *
 * Realm-scoped throughout. Note the id lookups: a transfer is fetched by
 * (id, realm_id), never by id alone, so holding another realm's transfer id
 * gets you "not found" rather than someone else's goods.
 */
import { getDb } from './db.js';

/** Owner/admin: send a pending transfer; debits the sender's stock now. */
export async function createTransfer(env, fromBusiness, { toBusiness, item, qty, idempotencyKey }, realmId) {
  const db = await getDb(env);
  const idem = String(idempotencyKey || '').trim();
  if (idem) {
    const prior = await db.prepare('SELECT id FROM transfers WHERE realm_id = ? AND from_business = ? AND idem = ? LIMIT 1')
      .bind(realmId, fromBusiness, idem).first();
    if (prior) return { ok: true, duplicate: true }; // already sent — no double debit
  }
  const to = String(toBusiness || '').trim();
  const it = String(item || '').trim();
  const n = Math.floor(Number(qty));
  if (!to) throw new Error('Pick a receiving company.');
  if (to.toLowerCase() === String(fromBusiness || '').trim().toLowerCase()) {
    throw new Error('You can’t transfer to your own company.');
  }
  if (!it) throw new Error('Pick an item to transfer.');
  if (!n || n < 1) throw new Error('Enter a quantity of at least 1.');

  const { results } = await db.prepare(
    'SELECT item, price, stock FROM inventory WHERE realm_id = ? AND business = ? AND item = ?').bind(realmId, fromBusiness, it).all();
  const row = results && results[0];
  if (!row) throw new Error('Item not found in your inventory: ' + it);
  if (row.stock < n) throw new Error('Not enough stock (have ' + row.stock + ', transferring ' + n + ').');

  await db.batch([
    db.prepare('UPDATE inventory SET stock = stock - ? WHERE realm_id = ? AND business = ? AND item = ?').bind(n, realmId, fromBusiness, it),
    db.prepare(
      `INSERT INTO transfers (realm_id, from_business, to_business, item, qty, price, status, ts, idem)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`).bind(realmId, fromBusiness, to, it, n, row.price, new Date().toISOString(), idem || null),
  ]);
  return { ok: true };
}

/** Pending transfers touching a business: incoming (to accept) and outgoing (awaiting). */
export async function listTransfers(env, business, realmId) {
  const db = await getDb(env);
  const incoming = ((await db.prepare(
    `SELECT id, from_business AS other, item, qty, ts FROM transfers
      WHERE realm_id = ? AND to_business = ? AND status = 'pending' ORDER BY id DESC`).bind(realmId, business).all()).results) || [];
  const outgoing = ((await db.prepare(
    `SELECT id, to_business AS other, item, qty, ts FROM transfers
      WHERE realm_id = ? AND from_business = ? AND status = 'pending' ORDER BY id DESC`).bind(realmId, business).all()).results) || [];
  return { incoming, outgoing };
}

/** Receiver owner/admin: accept a pending transfer, adding the goods to stock. */
export async function acceptTransfer(env, business, id, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare('SELECT * FROM transfers WHERE id = ? AND realm_id = ?').bind(Number(id), realmId).all();
  const t = results && results[0];
  if (!t) throw new Error('Transfer not found.');
  if (String(t.to_business).trim().toLowerCase() !== String(business).trim().toLowerCase()) {
    throw new Error('That transfer isn’t addressed to your company.');
  }
  if (String(t.status) !== 'pending') throw new Error('That transfer is no longer pending.');

  await db.batch([
    db.prepare(
      `INSERT INTO inventory (realm_id, business, item, price, stock, low_stock) VALUES (?, ?, ?, ?, ?, 0)
       ON CONFLICT(realm_id, business, item) DO UPDATE SET stock = stock + excluded.stock`)
      .bind(realmId, business, t.item, t.price, t.qty),
    db.prepare("UPDATE transfers SET status = 'accepted' WHERE id = ?").bind(Number(id)),
  ]);
  return { ok: true };
}

/**
 * Returns a pending transfer's goods to the SENDER and closes it. Used by both
 * the sender cancelling an outgoing transfer and the receiver declining an
 * incoming one — the stock always goes back where it came from.
 */
async function returnTransfer(env, id, { fromBusiness, toBusiness, status }, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare('SELECT * FROM transfers WHERE id = ? AND realm_id = ?').bind(Number(id), realmId).all();
  const t = results && results[0];
  if (!t) throw new Error('Transfer not found.');
  if (String(t.status) !== 'pending') throw new Error('That transfer is no longer pending.');
  if (fromBusiness && String(t.from_business).trim().toLowerCase() !== fromBusiness.trim().toLowerCase()) {
    throw new Error('That transfer isn’t yours to cancel.');
  }
  if (toBusiness && String(t.to_business).trim().toLowerCase() !== toBusiness.trim().toLowerCase()) {
    throw new Error('That transfer isn’t addressed to your company.');
  }
  await db.batch([
    db.prepare(
      `INSERT INTO inventory (realm_id, business, item, price, stock, low_stock) VALUES (?, ?, ?, ?, ?, 0)
       ON CONFLICT(realm_id, business, item) DO UPDATE SET stock = stock + excluded.stock`)
      .bind(realmId, t.from_business, t.item, t.price, t.qty),
    db.prepare('UPDATE transfers SET status = ? WHERE id = ?').bind(status, Number(id)),
  ]);
  return { ok: true };
}

/** Sender owner/admin: cancel an outgoing pending transfer (goods return to you). */
export async function cancelTransfer(env, business, id, realmId) {
  return returnTransfer(env, id, { fromBusiness: business, status: 'cancelled' }, realmId);
}

/** Receiver owner/admin: decline an incoming pending transfer (goods return to sender). */
export async function declineTransfer(env, business, id, realmId) {
  return returnTransfer(env, id, { toBusiness: business, status: 'declined' }, realmId);
}

/** Recent transfers touching a business, any status (for the history view). */
export async function listTransferHistory(env, business, realmId, limit = 30) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    `SELECT id, from_business, to_business, item, qty, status, ts FROM transfers
      WHERE realm_id = ? AND (from_business = ? OR to_business = ?) ORDER BY id DESC LIMIT ?`)
    .bind(realmId, business, business, limit).all();
  return (results || []).map((r) => ({
    id: r.id, from: r.from_business, to: r.to_business,
    item: r.item, qty: r.qty, status: r.status, ts: r.ts,
    dir: String(r.from_business).trim().toLowerCase() === String(business).trim().toLowerCase() ? 'out' : 'in',
  }));
}

/** How many transfers are waiting for this business to accept. */
export async function countIncomingPending(env, business, realmId) {
  const db = await getDb(env);
  const r = await db.prepare(
    "SELECT COUNT(*) AS n FROM transfers WHERE realm_id = ? AND to_business = ? AND status = 'pending'").bind(realmId, business).first();
  return r ? r.n : 0;
}
