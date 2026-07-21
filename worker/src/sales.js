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
import { listItemIndex, matchMasterItem } from './item-index.js';
import { logAudit } from './audit.js';

/**
 * "Name x2 @ 30gp, Other x1 @ 5gp" -> [{name, qty, price}], counting failures.
 * Tolerant of the legacy "@ $30" form too, so older rows still void correctly.
 */
export function parseSaleItems(field) {
  const out = { lines: [], unparsed: 0 };
  String(field || '').split(',').forEach((seg) => {
    seg = seg.trim();
    if (!seg) return;
    const m = seg.match(/^(.*) x(\d+) @ \$?([0-9]+(?:\.[0-9]+)?)(?:gp)?$/);
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
export async function checkout(env, business, caller, { cart, customer, hold, discountName, discountPercent, idempotencyKey }) {
  const db = await getDb(env);
  // Idempotency: a retried submit with the same key returns the original sale
  // instead of ringing it up twice.
  const idem = String(idempotencyKey || '').trim();
  if (idem) {
    const prior = await db.prepare('SELECT order_no, total FROM sales WHERE business = ? AND idem = ? LIMIT 1').bind(business, idem).first();
    if (prior) return { ok: true, orderNo: prior.order_no, total: prior.total, duplicate: true };
  }

  const cert = await checkCertification(env, business);
  if (cert.status === 'EXPIRED') {
    throw new Error("This shop's East Empire certification has EXPIRED — an admin must renew it before you can sell.");
  }
  if (!Array.isArray(cart) || !cart.length) throw new Error('The cart is empty.');
  const holdName = String(hold || '').trim();
  if (!holdName) throw new Error('Pick the hold this sale happened in.');

  const master = await listItemIndex(env);
  const { results } = await db.prepare('SELECT item, price, stock FROM inventory WHERE business = ?').bind(business).all();
  const inv = {};
  (results || []).forEach((r) => { inv[r.item.toLowerCase()] = { item: r.item, price: r.price, stock: r.stock }; });

  const need = {};            // in-inventory items → stock decrements
  const lines = [];
  const offInventory = [];    // sold but not in this shop's inventory
  const newItems = [];        // not in the master index → excluded from market
  let subtotal = 0;
  let qtyTotal = 0;
  for (const line of cart) {
    let name = String(line.item || '').trim();
    if (!name) throw new Error('Each line needs an item.');
    // Normalize typos/grammar to the canonical master name where we can.
    const canon = matchMasterItem(name, master);
    const inMaster = !!canon;
    if (canon) name = canon.name;
    const invItem = inv[name.toLowerCase()];
    const inInv = !!invItem;

    const qty = Math.floor(Number(line.qty));
    if (!qty || qty < 1) throw new Error('Bad quantity for ' + name + '.');
    // Sold-for price wins; else the shop's own price; else the master base value.
    let price = Number(line.price);
    if (!isFinite(price) || price < 0) price = inInv ? invItem.price : (inMaster ? canon.baseValue : 0);

    if (inInv) need[invItem.item] = (need[invItem.item] || 0) + qty;
    else offInventory.push(name);
    if (!inMaster) newItems.push(name);

    subtotal += price * qty;
    qtyTotal += qty;
    lines.push({ name, qty, price });
  }
  // Only in-inventory items are stock-checked (off-inventory items still sell).
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
  const itemSummary = lines.map((l) => l.name + ' x' + l.qty + ' @ ' + l.price + 'gp').join(', ');
  const ts = new Date().toISOString();
  const employee = caller.character || caller.email;

  const stmts = [];
  for (const item in need) {
    stmts.push(db.prepare('UPDATE inventory SET stock = stock - ? WHERE business = ? AND item = ?').bind(need[item], business, item));
  }
  stmts.push(db.prepare(
    `INSERT INTO sales (business, ts, order_no, customer, hold, items, qty_total, total, employee, discount, status, idem)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)`
  ).bind(business, ts, orderNo, String(customer || '').trim() || 'Walk-in', holdName, itemSummary, qtyTotal, finalTotal, employee, discountLabel, idem || null));
  // Credit the shop's coffers with the sale proceeds.
  stmts.push(db.prepare(
    `INSERT INTO coffer_entries (business, ts, kind, amount, note) VALUES (?, ?, 'sale', ?, ?)`
  ).bind(business, ts, finalTotal, orderNo));
  await db.batch(stmts);

  // Flag off-inventory / non-master (new) items in the audit log — the sale
  // still processes so the data is captured, but new items stay out of market.
  const actor = caller.character || caller.email;
  const offList = [...new Set(offInventory)];
  const newList = [...new Set(newItems)];
  if (offList.length) await logAudit(env, { actor, business, action: 'sale.off_inventory', detail: orderNo + ': ' + offList.join(', ') });
  if (newList.length) await logAudit(env, { actor, business, action: 'sale.new_item', detail: orderNo + ': ' + newList.join(', ') });

  return { ok: true, orderNo, total: finalTotal, hold: holdName, discount: discountLabel, offInventory: offList, newItems: newList };
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

/** Per-employee sales performance for a business (voided sales excluded). */
export async function employeePerformance(env, business) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    `SELECT employee, COUNT(*) AS orders,
            COALESCE(SUM(qty_total), 0) AS items, COALESCE(SUM(total), 0) AS revenue
       FROM sales WHERE business = ? AND status != 'VOIDED'
      GROUP BY employee ORDER BY revenue DESC`).bind(business).all();
  return (results || []).map((r) => ({
    employee: r.employee || '(unknown)', orders: r.orders, items: r.items, revenue: r.revenue,
  }));
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
  // Reverse the coffer credit from the original sale.
  stmts.push(db.prepare(
    `INSERT INTO coffer_entries (business, ts, kind, amount, note) VALUES (?, ?, 'void', ?, ?)`
  ).bind(business, new Date().toISOString(), -Number(sale.total || 0), 'Void ' + order));
  await db.batch(stmts);
  return { ok: true, orderNo: order };
}
