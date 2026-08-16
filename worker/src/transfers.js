/**
 * Inventory transfers between companies (D1).
 *
 * A TRANSFER IS A SHIPMENT, not an item — one crate with several things in it,
 * the same way a delivery is a trip rather than a purchase (see
 * `recordIntakeLines`). Sending it removes every line from the sender's stock
 * immediately; nothing reaches the receiver until they ACCEPT, and then the
 * whole shipment lands at once. Accepting half a crate is not a thing a person
 * can do at a loading bay, and it is not a thing they can do here.
 *
 * That is why the lines live on the transfer ROW as JSON rather than as their
 * own table: one row is one shipment, so accept, decline and cancel stay single
 * writes that cannot half-happen, and the ids the routes already take still name
 * exactly one thing. `sales` stores its lines the same way and for the same
 * reason.
 *
 * The old `item` / `qty` / `price` columns are still written — item and price
 * from the first line, qty as the TOTAL units — so a one-line shipment is
 * stored exactly as it always was. Nothing READS them unless `items` is
 * missing, which is only true of rows written before shipments existed.
 *
 * Realm-scoped throughout. Note the id lookups: a transfer is fetched by
 * (id, realm_id), never by id alone, so holding another realm's transfer id
 * gets you "not found" rather than someone else's goods.
 */
import { getDb } from './db.js';

/**
 * A stored transfer's lines.
 *
 * `items` is the truth when it is there. A row without it predates shipments
 * and carries its single line in the old columns — which is why this never
 * throws on a bad parse: an unreadable `items` must fall back to something,
 * not lose the goods.
 */
export function transferLines(row) {
  if (row && row.items) {
    try {
      const parsed = JSON.parse(row.items);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((l) => ({
          item: String(l.item || ''),
          qty: Math.floor(Number(l.qty) || 0),
          price: Number(l.price) || 0,
        }));
      }
    } catch (e) { /* fall through to the legacy columns */ }
  }
  return [{ item: String((row && row.item) || ''), qty: Math.floor(Number(row && row.qty) || 0), price: Number((row && row.price) || 0) }];
}

/** The units in a shipment — what moved, not how many kinds of thing. */
const unitsIn = (lines) => lines.reduce((n, l) => n + l.qty, 0);

/** How a shipment reads in one line: "Iron Sword ×3" or "Iron Sword ×3 + 2 more". */
export function transferSummary(lines) {
  if (!lines.length) return '';
  const first = lines[0].item + ' ×' + lines[0].qty;
  return lines.length === 1 ? first : first + ' + ' + (lines.length - 1) + ' more';
}

/**
 * Owner/admin: send a pending shipment; debits the sender's stock now.
 *
 * Accepts `items: [{ item, qty }]`, and a bare `{ item, qty }` for a browser
 * still running the bundle from before this was a shipment — a page left open
 * across the deploy must send goods, not an error.
 */
export async function createTransfer(env, fromBusiness, { toBusiness, items, item, qty, idempotencyKey }, realmId) {
  const db = await getDb(env);
  const idem = String(idempotencyKey || '').trim();
  if (idem) {
    const prior = await db.prepare('SELECT id FROM transfers WHERE realm_id = ? AND from_business = ? AND idem = ? LIMIT 1')
      .bind(realmId, fromBusiness, idem).first();
    if (prior) return { ok: true, duplicate: true }; // already sent — no double debit
  }
  const to = String(toBusiness || '').trim();
  if (!to) throw new Error('Pick a receiving company.');
  if (to.toLowerCase() === String(fromBusiness || '').trim().toLowerCase()) {
    throw new Error('You can’t transfer to your own company.');
  }

  const asked = Array.isArray(items) && items.length ? items : [{ item, qty }];

  /**
   * VALIDATE EVERY LINE FIRST, and add up the ones naming the same item.
   *
   * Two lines of 5 against a stock of 8 both pass a per-line check and take 10
   * — the shelf goes negative and nobody sees an error. Folding them makes the
   * check ask the only question worth asking: how much of this is going, in
   * total?
   */
  const wanted = new Map();
  for (let i = 0; i < asked.length; i++) {
    const l = asked[i] || {};
    const where = asked.length > 1 ? ' (item ' + (i + 1) + ')' : '';
    const name = String(l.item || '').trim();
    if (!name) throw new Error('Pick an item to transfer.' + where);
    const n = Math.floor(Number(l.qty));
    if (!isFinite(n) || n < 1) throw new Error('Enter a quantity of at least 1.' + where);
    const key = name.toLowerCase();
    const prev = wanted.get(key);
    wanted.set(key, { name: prev ? prev.name : name, qty: (prev ? prev.qty : 0) + n });
  }

  // Read the sender's shelf for exactly the items asked for. Matched on the
  // lowered name, since the inventory's uniqueness is on the raw one and a
  // shipment typed in another case must still find the row it means.
  const lines = [];
  for (const [key, w] of wanted) {
    const row = await db.prepare(
      'SELECT item, price, stock FROM inventory WHERE realm_id = ? AND business = ? AND lower(item) = ?')
      .bind(realmId, fromBusiness, key).first();
    if (!row) throw new Error('Item not found in your inventory: ' + w.name);
    if (row.stock < w.qty) {
      throw new Error('Not enough ' + row.item + ' (have ' + row.stock + ', transferring ' + w.qty + ').');
    }
    lines.push({ item: row.item, qty: w.qty, price: row.price });
  }

  const stmts = lines.map((l) => db.prepare(
    'UPDATE inventory SET stock = stock - ? WHERE realm_id = ? AND business = ? AND item = ?')
    .bind(l.qty, realmId, fromBusiness, l.item));
  stmts.push(db.prepare(
    `INSERT INTO transfers (realm_id, from_business, to_business, item, qty, price, items, status, ts, idem)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
    .bind(realmId, fromBusiness, to, lines[0].item, unitsIn(lines), lines[0].price,
      JSON.stringify(lines), new Date().toISOString(), idem || null));
  await db.batch(stmts);
  return { ok: true };
}

/** One pending shipment, as a screen needs it: who, what, and how much of it. */
const pendingRow = (r) => {
  const lines = transferLines(r);
  return { id: r.id, other: r.other, lines, units: unitsIn(lines), summary: transferSummary(lines), ts: r.ts };
};

/** Pending transfers touching a business: incoming (to accept) and outgoing (awaiting). */
export async function listTransfers(env, business, realmId) {
  const db = await getDb(env);
  const incoming = ((await db.prepare(
    `SELECT id, from_business AS other, item, qty, price, items, ts FROM transfers
      WHERE realm_id = ? AND to_business = ? AND status = 'pending' ORDER BY id DESC`).bind(realmId, business).all()).results) || [];
  const outgoing = ((await db.prepare(
    `SELECT id, to_business AS other, item, qty, price, items, ts FROM transfers
      WHERE realm_id = ? AND from_business = ? AND status = 'pending' ORDER BY id DESC`).bind(realmId, business).all()).results) || [];
  return { incoming: incoming.map(pendingRow), outgoing: outgoing.map(pendingRow) };
}

/** Adds a shipment's lines to a shop's shelf, creating any listing it lacks. */
const creditLines = (db, realmId, business, lines) => lines.map((l) => db.prepare(
  `INSERT INTO inventory (realm_id, business, item, price, stock, low_stock) VALUES (?, ?, ?, ?, ?, 0)
   ON CONFLICT(realm_id, business, item) DO UPDATE SET stock = stock + excluded.stock`)
  .bind(realmId, business, l.item, l.price, l.qty));

/** Receiver owner/admin: accept a pending shipment, adding every line to stock. */
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
    ...creditLines(db, realmId, business, transferLines(t)),
    db.prepare("UPDATE transfers SET status = 'accepted' WHERE id = ?").bind(Number(id)),
  ]);
  return { ok: true };
}

/**
 * Returns a pending shipment's goods to the SENDER and closes it. Used by both
 * the sender cancelling an outgoing transfer and the receiver declining an
 * incoming one — the stock always goes back where it came from, every line of
 * it, in one write.
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
    ...creditLines(db, realmId, t.from_business, transferLines(t)),
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
    `SELECT id, from_business, to_business, item, qty, price, items, status, ts FROM transfers
      WHERE realm_id = ? AND (from_business = ? OR to_business = ?) ORDER BY id DESC LIMIT ?`)
    .bind(realmId, business, business, limit).all();
  return (results || []).map((r) => {
    const lines = transferLines(r);
    return {
      id: r.id, from: r.from_business, to: r.to_business,
      lines, units: unitsIn(lines), summary: transferSummary(lines),
      status: r.status, ts: r.ts,
      dir: String(r.from_business).trim().toLowerCase() === String(business).trim().toLowerCase() ? 'out' : 'in',
    };
  });
}

/** How many transfers are waiting for this business to accept. */
export async function countIncomingPending(env, business, realmId) {
  const db = await getDb(env);
  const r = await db.prepare(
    "SELECT COUNT(*) AS n FROM transfers WHERE realm_id = ? AND to_business = ? AND status = 'pending'").bind(realmId, business).first();
  return r ? r.n : 0;
}
