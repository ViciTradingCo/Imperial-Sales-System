/**
 * Sales (D1): checkout, order lookup, and void.
 *
 * Checkout validates stock, decrements it, and logs the sale in one atomic
 * batch. Void restores the stock and marks the sale VOIDED (voided sales are
 * excluded from stats). The item summary is stored as
 * "Name xQty @ $Price, ..." — the same shape the original used — and parsed
 * back on void to restore stock.
 */
import { getDb } from './db.js';
import { checkCertification } from './cert.js';

/** "Name x2 @ $30, Other x1 @ $5" -> [{name, qty, price}], counting failures. */
export function parseSaleItems(field) {
  const out = { lines: [], unparsed: 0 };
  String(field || '').split(',').forEach((seg) => {
    seg = seg.trim();
    if (!seg) return;
    const m = seg.match(/^(.*) x(\d+) @ \$([0-9]+(?:\.[0-9]+)?)$/);
    if (m) { out.lines.push({ name: m[1].trim(), qty: Number(m[2]), price: Number(m[3]) }); return; }
    out.unparsed++;
  });
  return out;
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getFullYear() % 100) + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function mapSale(r) {
  return {
    orderNo: r.order_no, ts: r.ts, customer: r.customer, hold: r.hold,
    items: r.items, qtyTotal: r.qty_total, total: r.total,
    employee: r.employee, discount: r.discount, status: r.status || '',
  };
}

/**
 * Rings up a multi-item sale. cart = [{item, qty, price}] where price is the
 * actual sold-for amount per unit. Attributed to the caller's character.
 */
export async function checkout(env, business, caller, { cart, customer, hold, discountName, discountPercent }) {
  const cert = await checkCertification(env, business);
  if (cert.status === 'EXPIRED') {
    throw new Error("This shop's East Empire certification has EXPIRED — an admin must renew it before you can sell.");
  }
  if (!Array.isArray(cart) || !cart.length) throw new Error('The cart is empty.');
  const holdName = String(hold || '').trim();
  if (!holdName) throw new Error('Pick the hold this sale happened in.');

  const db = await getDb(env);
  const { results } = await db.prepare('SELECT item, price, stock FROM inventory WHERE business = ?').bind(business).all();
  const inv = {};
  (results || []).forEach((r) => { inv[r.item.toLowerCase()] = { item: r.item, price: r.price, stock: r.stock }; });

  const need = {};
  const lines = [];
  let subtotal = 0;
  let qtyTotal = 0;
  for (const line of cart) {
    const it = inv[String(line.item || '').trim().toLowerCase()];
    if (!it) throw new Error('Item not found: ' + line.item);
    const qty = Math.floor(Number(line.qty));
    if (!qty || qty < 1) throw new Error('Bad quantity for ' + it.item + '.');
    const price = Number(line.price);
    if (!isFinite(price) || price < 0) throw new Error('Bad sold-for price for ' + it.item + '.');
    need[it.item] = (need[it.item] || 0) + qty;
    subtotal += price * qty;
    qtyTotal += qty;
    lines.push({ name: it.item, qty, price });
  }
  for (const item in need) {
    if (need[item] > inv[item.toLowerCase()].stock) {
      throw new Error('Not enough stock for ' + item + ' (have ' + inv[item.toLowerCase()].stock + ', cart wants ' + need[item] + ').');
    }
  }

  const pct = Number(discountPercent);
  const discPct = isFinite(pct) && pct > 0 && pct <= 100 ? pct : 0;
  const finalTotal = discPct ? Math.round(subtotal * (100 - discPct)) / 100 : subtotal;
  const discountLabel = discPct
    ? (String(discountName || '').trim() ? String(discountName).trim() + ' ' : '') + '(' + discPct + '%)'
    : '';

  const orderNo = 'ORD-' + stamp(new Date());
  const itemSummary = lines.map((l) => l.name + ' x' + l.qty + ' @ $' + l.price).join(', ');
  const ts = new Date().toISOString();
  const employee = caller.character || caller.email;

  const stmts = [];
  for (const item in need) {
    stmts.push(db.prepare('UPDATE inventory SET stock = stock - ? WHERE business = ? AND item = ?').bind(need[item], business, item));
  }
  stmts.push(db.prepare(
    `INSERT INTO sales (business, ts, order_no, customer, hold, items, qty_total, total, employee, discount, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')`
  ).bind(business, ts, orderNo, String(customer || '').trim() || 'Walk-in', holdName, itemSummary, qtyTotal, finalTotal, employee, discountLabel));
  await db.batch(stmts);

  return { ok: true, orderNo, total: finalTotal, hold: holdName, discount: discountLabel };
}

/** Recent sales, optionally filtered by order #, customer, or employee. */
export async function listSales(env, business, query, limit = 25) {
  const db = await getDb(env);
  const q = String(query || '').trim().toLowerCase();
  let rows;
  if (q) {
    const like = '%' + q + '%';
    ({ results: rows } = await db.prepare(
      `SELECT * FROM sales WHERE business = ?
       AND (lower(order_no) LIKE ? OR lower(customer) LIKE ? OR lower(employee) LIKE ?)
       ORDER BY id DESC LIMIT ?`
    ).bind(business, like, like, like, limit).all());
  } else {
    ({ results: rows } = await db.prepare('SELECT * FROM sales WHERE business = ? ORDER BY id DESC LIMIT ?').bind(business, limit).all());
  }
  return (rows || []).map(mapSale);
}

/** Voids a sale: restores stock and marks it VOIDED (atomic). */
export async function voidSale(env, business, orderNo) {
  const db = await getDb(env);
  const order = String(orderNo || '').trim();
  const { results } = await db.prepare('SELECT * FROM sales WHERE business = ? AND order_no = ?').bind(business, order).all();
  const sale = results && results[0];
  if (!sale) throw new Error('Order not found: ' + order);
  if (String(sale.status).toUpperCase() === 'VOIDED') throw new Error('That order is already voided.');

  const parsed = parseSaleItems(sale.items);
  const stmts = parsed.lines.map((l) =>
    db.prepare('UPDATE inventory SET stock = stock + ? WHERE business = ? AND item = ?').bind(l.qty, business, l.name)
  );
  stmts.push(db.prepare("UPDATE sales SET status = 'VOIDED' WHERE business = ? AND order_no = ?").bind(business, order));
  await db.batch(stmts);
  return { ok: true, orderNo: order };
}
