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
import { readRealmPrefs } from './realm-prefs.js';
import { listItemIndex, matchMasterItem } from './item-index.js';
import { logAudit } from './audit.js';

/**
 * A sale's lines, as DATA: [{name, qty, price}].
 *
 * New sales store JSON. That is the whole point — the numbers are the record and
 * the denomination is presentation, so a realm renaming its money (or a shop
 * being read by a realm that calls it something else) can never make old rows
 * wrong or unparseable.
 *
 * Older rows are a formatted string — "Iron Sword x2 @ 30gp" — from when the
 * unit was baked in. They're still read here, tolerating the even older "@ $30"
 * form, so history keeps voiding and reporting correctly. Nothing rewrites them;
 * they simply parse.
 */
export function parseSaleItems(field) {
  const out = { lines: [], unparsed: 0 };
  const raw = String(field || '').trim();
  if (!raw) return out;

  // Current form: a JSON array of lines.
  if (raw.startsWith('[')) {
    try {
      const rows = JSON.parse(raw);
      if (Array.isArray(rows)) {
        rows.forEach((r) => {
          const name = String((r && r.name) || '').trim();
          const qty = Number(r && r.qty);
          const price = Number(r && r.price);
          if (name && isFinite(qty) && isFinite(price)) out.lines.push({ name, qty, price });
          else out.unparsed++;
        });
        return out;
      }
    } catch (e) { /* fall through to the legacy reader */ }
  }

  // Legacy form: "Name x2 @ 30gp, Other x1 @ 5".
  raw.split(',').forEach((seg) => {
    seg = seg.trim();
    if (!seg) return;
    const m = seg.match(/^(.*) x(\d+) @ \$?([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z]*)$/);
    if (m) { out.lines.push({ name: m[1].trim(), qty: Number(m[2]), price: Number(m[3]) }); return; }
    out.unparsed++;
  });
  return out;
}

/** Serializes a sale's lines for storage. Numbers only — no unit. */
export function encodeSaleItems(lines) {
  return JSON.stringify((lines || []).map((l) => ({ name: l.name, qty: l.qty, price: l.price })));
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getFullYear() % 100) + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

/**
 * A unique order number. The timestamp alone is only second-resolution, so two
 * sales rung up in the same second at one shop used to COLLIDE — and voiding one
 * then voided both. The random suffix keeps them distinct (the offline queue
 * replays sales back-to-back, which made this easy to hit).
 */
function newOrderNo(d) {
  return 'ORD-' + stamp(d) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function mapSale(r) {
  return {
    orderNo: r.order_no, ts: r.ts, customer: r.customer, hold: r.hold,
    // `lines` is the structured form the UI renders; `items` stays as stored so
    // exports and anything reading raw rows keep working.
    lines: parseSaleItems(r.items).lines,
    items: r.items, qtyTotal: r.qty_total, total: r.total,
    employee: r.employee, discount: r.discount, status: r.status || '',
  };
}

/**
 * Rings up a multi-item sale. cart = [{item, qty, price}] where price is the
 * actual sold-for amount per unit. Attributed to the caller's character.
 */
export async function checkout(env, business, caller, { cart, customer, hold, discountName, discountPercent, idempotencyKey }, realmId) {
  const db = await getDb(env);
  // Idempotency: a retried submit with the same key returns the original sale
  // instead of ringing it up twice.
  const idem = String(idempotencyKey || '').trim();
  if (idem) {
    const prior = await db.prepare('SELECT order_no, total FROM sales WHERE realm_id = ? AND business = ? AND idem = ? LIMIT 1')
      .bind(realmId, business, idem).first();
    if (prior) return { ok: true, orderNo: prior.order_no, total: prior.total, duplicate: true };
  }

  const cert = await checkCertification(env, business, realmId);
  if (cert.status === 'EXPIRED') {
    throw new Error("This shop's Vici Trading Co. certification has EXPIRED — an admin must renew it before you can sell.");
  }
  if (!Array.isArray(cart) || !cart.length) throw new Error('The cart is empty.');
  // The region is only demanded when this realm's register asks for one; a
  // realm with the field switched off records sales with no region, and its
  // region reports simply have nothing to group.
  const prefs = await readRealmPrefs(env, realmId);
  const holdName = String(hold || '').trim();
  if (!holdName && prefs.showRegion) {
    throw new Error('Pick the ' + prefs.regionLabel.toLowerCase() + ' this sale happened in.');
  }

  const master = await listItemIndex(env, realmId);
  const { results } = await db.prepare('SELECT item, price, stock FROM inventory WHERE realm_id = ? AND business = ?')
    .bind(realmId, business).all();
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
  // Always settle money to 2dp — float sums like 0.1+0.2 would otherwise store
  // (and later refund) a value with a long fractional tail.
  const finalTotal = discPct
    ? Math.round(subtotal * (100 - discPct)) / 100
    : Math.round(subtotal * 100) / 100;
  const discountLabel = discPct
    ? (String(discountName || '').trim() ? String(discountName).trim() + ' ' : '') + '(' + discPct + '%)'
    : '';

  const orderNo = newOrderNo(new Date());
  // Stored as data, not as a sentence: the denomination is applied when it is
  // shown, so renaming a realm's money never invalidates its history.
  const itemSummary = encodeSaleItems(lines);
  const ts = new Date().toISOString();
  const employee = caller.character || caller.email;

  const stmts = [];
  for (const item in need) {
    stmts.push(db.prepare('UPDATE inventory SET stock = stock - ? WHERE realm_id = ? AND business = ? AND item = ?').bind(need[item], realmId, business, item));
  }
  stmts.push(db.prepare(
    `INSERT INTO sales (realm_id, business, ts, order_no, customer, hold, items, qty_total, total, employee, discount, status, idem)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)`
  ).bind(realmId, business, ts, orderNo, String(customer || '').trim() || 'Walk-in', holdName, itemSummary, qtyTotal, finalTotal, employee, discountLabel, idem || null));
  // Credit the shop's coffers with the sale proceeds.
  stmts.push(db.prepare(
    `INSERT INTO coffer_entries (realm_id, business, ts, kind, amount, note) VALUES (?, ?, ?, 'sale', ?, ?)`
  ).bind(realmId, business, ts, finalTotal, orderNo));
  await db.batch(stmts);

  // Flag off-inventory / non-master (new) items in the audit log — the sale
  // still processes so the data is captured, but new items stay out of market.
  const actor = caller.character || caller.email;
  const offList = [...new Set(offInventory)];
  const newList = [...new Set(newItems)];
  if (offList.length) await logAudit(env, { actor, business, action: 'sale.off_inventory', detail: orderNo + ': ' + offList.join(', '), realmId });
  if (newList.length) await logAudit(env, { actor, business, action: 'sale.new_item', detail: orderNo + ': ' + newList.join(', '), realmId });

  return { ok: true, orderNo, total: finalTotal, hold: holdName, discount: discountLabel, offInventory: offList, newItems: newList };
}

/** Recent sales, optionally filtered by order #, customer, or employee. */
export async function listSales(env, business, query, realmId, limit = 25) {
  const db = await getDb(env);
  const q = String(query || '').trim().toLowerCase();
  let rows;
  if (q) {
    const like = '%' + q + '%';
    ({ results: rows } = await db.prepare(
      `SELECT * FROM sales WHERE realm_id = ? AND business = ?
       AND (lower(order_no) LIKE ? OR lower(customer) LIKE ? OR lower(employee) LIKE ?)
       ORDER BY id DESC LIMIT ?`
    ).bind(realmId, business, like, like, like, limit).all());
  } else {
    ({ results: rows } = await db.prepare('SELECT * FROM sales WHERE realm_id = ? AND business = ? ORDER BY id DESC LIMIT ?').bind(realmId, business, limit).all());
  }
  return (rows || []).map(mapSale);
}

/** Per-employee sales performance for a business (voided sales excluded). */
export async function employeePerformance(env, business, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    `SELECT employee, COUNT(*) AS orders,
            COALESCE(SUM(qty_total), 0) AS items, COALESCE(SUM(total), 0) AS revenue
       FROM sales WHERE realm_id = ? AND business = ? AND status != 'VOIDED'
      GROUP BY employee ORDER BY revenue DESC`).bind(realmId, business).all();
  return (results || []).map((r) => ({
    employee: r.employee || '(unknown)', orders: r.orders, items: r.items, revenue: r.revenue,
  }));
}

/** Voids a sale: restores stock and marks it VOIDED (atomic). */
export async function voidSale(env, business, orderNo, realmId) {
  const db = await getDb(env);
  const order = String(orderNo || '').trim();
  // Target the OLDEST un-voided row for this order number and act on its id, so
  // a legacy duplicate order number can't void (and under-refund) two sales.
  const sale = await db.prepare(
    "SELECT * FROM sales WHERE realm_id = ? AND business = ? AND order_no = ? AND upper(COALESCE(status, '')) != 'VOIDED' ORDER BY id LIMIT 1"
  ).bind(realmId, business, order).first();
  if (!sale) {
    const any = await db.prepare('SELECT id FROM sales WHERE realm_id = ? AND business = ? AND order_no = ? LIMIT 1').bind(realmId, business, order).first();
    if (any) throw new Error('That order is already voided.');
    throw new Error('Order not found: ' + order);
  }

  const parsed = parseSaleItems(sale.items);
  const stmts = parsed.lines.map((l) =>
    db.prepare('UPDATE inventory SET stock = stock + ? WHERE realm_id = ? AND business = ? AND item = ?').bind(l.qty, realmId, business, l.name)
  );
  stmts.push(db.prepare("UPDATE sales SET status = 'VOIDED' WHERE id = ?").bind(sale.id));
  // Reverse the coffer credit from the original sale.
  stmts.push(db.prepare(
    `INSERT INTO coffer_entries (realm_id, business, ts, kind, amount, note) VALUES (?, ?, ?, 'void', ?, ?)`
  ).bind(realmId, business, new Date().toISOString(), -Number(sale.total || 0), 'Void ' + order));
  await db.batch(stmts);
  return { ok: true, orderNo: order };
}
