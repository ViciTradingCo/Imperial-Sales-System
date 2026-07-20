/**
 * Inventory transfers between companies (D1).
 *
 * Sending a transfer removes the goods from the sender's stock immediately, but
 * they do NOT appear in the receiver's inventory until the receiver ACCEPTS —
 * at which point the stock is added to the receiver (creating the item if new).
 * Everything is done in atomic batches so stock is never double-counted.
 */
import { getDb } from './db.js';

/** Owner/admin: send a pending transfer; debits the sender's stock now. */
export async function createTransfer(env, fromBusiness, { toBusiness, item, qty }) {
  const to = String(toBusiness || '').trim();
  const it = String(item || '').trim();
  const n = Math.floor(Number(qty));
  if (!to) throw new Error('Pick a receiving company.');
  if (to.toLowerCase() === String(fromBusiness || '').trim().toLowerCase()) {
    throw new Error('You can’t transfer to your own company.');
  }
  if (!it) throw new Error('Pick an item to transfer.');
  if (!n || n < 1) throw new Error('Enter a quantity of at least 1.');

  const db = await getDb(env);
  const { results } = await db.prepare(
    'SELECT item, price, stock FROM inventory WHERE business = ? AND item = ?').bind(fromBusiness, it).all();
  const row = results && results[0];
  if (!row) throw new Error('Item not found in your inventory: ' + it);
  if (row.stock < n) throw new Error('Not enough stock (have ' + row.stock + ', transferring ' + n + ').');

  await db.batch([
    db.prepare('UPDATE inventory SET stock = stock - ? WHERE business = ? AND item = ?').bind(n, fromBusiness, it),
    db.prepare(
      `INSERT INTO transfers (from_business, to_business, item, qty, price, status, ts)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`).bind(fromBusiness, to, it, n, row.price, new Date().toISOString()),
  ]);
  return { ok: true };
}

/** Pending transfers touching a business: incoming (to accept) and outgoing (awaiting). */
export async function listTransfers(env, business) {
  const db = await getDb(env);
  const incoming = ((await db.prepare(
    `SELECT id, from_business AS other, item, qty, ts FROM transfers
      WHERE to_business = ? AND status = 'pending' ORDER BY id DESC`).bind(business).all()).results) || [];
  const outgoing = ((await db.prepare(
    `SELECT id, to_business AS other, item, qty, ts FROM transfers
      WHERE from_business = ? AND status = 'pending' ORDER BY id DESC`).bind(business).all()).results) || [];
  return { incoming, outgoing };
}

/** Receiver owner/admin: accept a pending transfer, adding the goods to stock. */
export async function acceptTransfer(env, business, id) {
  const db = await getDb(env);
  const { results } = await db.prepare('SELECT * FROM transfers WHERE id = ?').bind(Number(id)).all();
  const t = results && results[0];
  if (!t) throw new Error('Transfer not found.');
  if (String(t.to_business).trim().toLowerCase() !== String(business).trim().toLowerCase()) {
    throw new Error('That transfer isn’t addressed to your company.');
  }
  if (String(t.status) !== 'pending') throw new Error('That transfer is no longer pending.');

  await db.batch([
    db.prepare(
      `INSERT INTO inventory (business, item, price, stock, low_stock) VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(business, item) DO UPDATE SET stock = stock + excluded.stock`)
      .bind(business, t.item, t.price, t.qty),
    db.prepare("UPDATE transfers SET status = 'accepted' WHERE id = ?").bind(Number(id)),
  ]);
  return { ok: true };
}

/** How many transfers are waiting for this business to accept. */
export async function countIncomingPending(env, business) {
  const db = await getDb(env);
  const r = await db.prepare(
    "SELECT COUNT(*) AS n FROM transfers WHERE to_business = ? AND status = 'pending'").bind(business).first();
  return r ? r.n : 0;
}
