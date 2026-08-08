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
import { listItemIndex, matchMasterItem, notePendingItem } from './item-index.js';
import { logAudit } from './audit.js';
import { courtRules, standingOf, accrueLevy } from './court.js';
import { coin } from './money.js';

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
    staffPurchase: !!r.staff_purchase,
  };
}

/**
 * Rings up a multi-item sale. cart = [{item, qty, price}] where price is the
 * actual sold-for amount per unit. Attributed to the caller's character.
 */
export async function checkout(env, business, caller, { cart, customer, hold, discountName, discountPercent, staffPurchase, idempotencyKey }, realmId) {
  // An EMPLOYEE PURCHASE: stock leaves, nothing is charged. It is a real
  // movement of goods and belongs in the history, but it is not trade — so it
  // takes no money, credits no coffer, and is excluded from every statistic.
  // Counting a free item at 0 would drag an item's average price toward zero
  // and make a shop look like it gave its stock away.
  const staff = !!staffPurchase;
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

  // The region's Court, if it has one. Null when no company there holds the
  // flag, and then nothing below it costs anything.
  const rules = await courtRules(env, holdName, realmId);
  if (rules) {
    const standing = await standingOf(env, business, holdName, realmId);
    if (standing === 'banned') {
      throw new Error('The ' + rules.hold + ' Court has barred this shop from trading. Speak to ' +
        rules.seat + ' before selling again.');
    }
  }

  const master = await listItemIndex(env, realmId);
  const { results } = await db.prepare('SELECT item, price, stock, ingredient FROM inventory WHERE realm_id = ? AND business = ?')
    .bind(realmId, business).all();
  const inv = {};
  (results || []).forEach((r) => {
    inv[r.item.toLowerCase()] = { item: r.item, price: r.price, stock: r.stock, ingredient: !!r.ingredient };
  });

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
    // An INGREDIENT is stock held to craft with, not to sell. The register hides
    // them, but the refusal belongs here: the browser decides nothing, and a
    // stale page or a replayed offline sale would otherwise sell the materials.
    if (inInv && invItem.ingredient) {
      throw new Error(invItem.item + ' is marked as an ingredient — it is stock you craft with, not stock you ' +
        'sell. Untick "Ingredient" on the item in Inventory to sell it.');
    }

    const qty = Math.floor(Number(line.qty));
    if (!qty || qty < 1) throw new Error('Bad quantity for ' + name + '.');
    // Sold-for price wins; else the shop's own price; else the master base value.
    let price = Number(line.price);
    if (!isFinite(price) || price < 0) price = inInv ? invItem.price : (inMaster ? canon.baseValue : 0);

    if (inInv) need[invItem.item] = (need[invItem.item] || 0) + qty;
    else offInventory.push(name);
    if (!inMaster) newItems.push(name);

    // Price controls: a Court's floor and ceiling on what may be charged for an
    // item in its region. Checked per LINE and refused with the actual bound, so
    // the clerk is told what to change rather than that something is wrong.
    if (rules) {
      const cap = rules.prices.get(name.toLowerCase());
      if (cap && cap.max != null && price > cap.max) {
        throw new Error(rules.hold + ' Court caps ' + name + ' at ' + cap.max + ' — this line is at ' + price + '.');
      }
      if (cap && cap.min != null && price < cap.min) {
        throw new Error(rules.hold + ' Court sets a floor of ' + cap.min + ' on ' + name + ' — this line is at ' + price + '.');
      }
    }

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
  // A discount off nothing is nothing; an employee purchase ignores it rather
  // than recording a percentage that did no work.
  const discPct = !staff && isFinite(pct) && pct > 0 && pct <= 100 ? pct : 0;
  // The line arithmetic above is exact — fractional prices and percentage
  // discounts are allowed to produce whatever they produce. It is settled to a
  // whole coin ONCE, here, at the end: rounding every line would compound the
  // loss, and rounding down at the total is the customer's favour, once.
  const finalTotal = staff ? 0 : coin(discPct ? subtotal * (100 - discPct) / 100 : subtotal);
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
    `INSERT INTO sales (realm_id, business, ts, order_no, customer, hold, items, qty_total, total, employee, discount, status, idem, staff_purchase)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`
  ).bind(realmId, business, ts, orderNo, String(customer || '').trim() || (staff ? employee : 'Walk-in'),
    holdName, itemSummary, qtyTotal, finalTotal, employee, discountLabel, idem || null, staff ? 1 : 0));
  // Credit the shop's coffers with the sale proceeds — nothing to credit on an
  // employee purchase, and a 0 entry would be noise in the ledger.
  if (!staff) {
    stmts.push(db.prepare(
      `INSERT INTO coffer_entries (realm_id, business, ts, kind, amount, note) VALUES (?, ?, ?, 'sale', ?, ?)`
    ).bind(realmId, business, ts, finalTotal, orderNo));
  }
  await db.batch(stmts);

  // The levy: what this sale owes the region's Court. Recorded as a DEBT, never
  // taken — the Court marks it paid when it actually is. An employee purchase
  // took no money, so it owes nothing.
  const levy = staff ? 0 : await accrueLevy(env, rules, { business, total: finalTotal, orderNo }, realmId);

  const actor = caller.character || caller.email;
  const offList = [...new Set(offInventory)];
  const newList = [...new Set(newItems)];
  if (offList.length) await logAudit(env, { actor, business, action: 'sale.off_inventory', detail: orderNo + ': ' + offList.join(', '), realmId });

  /**
   * An item the index had never heard of goes INTO the index, flagged for
   * review, priced at what it just sold for.
   *
   * It used to be logged and dropped — the sale recorded, the item excluded
   * from the market forever, and nothing anywhere prompting anyone to add it.
   * That quietly held whatever nobody remembered to enter out of the realm's
   * own figures. Now the register can meet a new thing and the index learns it;
   * an admin confirms it or removes it as a duplicate.
   *
   * Not for an employee purchase: nothing was charged, so there is no price to
   * seed it with, and free stock is the worst possible evidence of worth.
   */
  if (newList.length) {
    await logAudit(env, { actor, business, action: 'sale.new_item', detail: orderNo + ': ' + newList.join(', '), realmId });
    if (!staff) {
      for (const name of newList) {
        const line = lines.find((l) => l.name === name);
        await notePendingItem(env, { name, baseValue: line ? line.price : 0, by: actor }, realmId);
      }
    }
  }

  return { ok: true, orderNo, total: finalTotal, hold: holdName, discount: discountLabel,
    staffPurchase: staff, levy, offInventory: offList, newItems: newList };
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

/**
 * Per-employee sales performance (voided sales and employee purchases both
 * excluded — neither is a sale this person made).
 */
export async function employeePerformance(env, business, realmId) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    `SELECT employee, COUNT(*) AS orders,
            COALESCE(SUM(qty_total), 0) AS items, COALESCE(SUM(total), 0) AS revenue
       FROM sales WHERE realm_id = ? AND business = ? AND status != 'VOIDED' AND staff_purchase = 0
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
  // Reverse the coffer credit from the original sale. A sale that took nothing
  // (an employee purchase, or a 100% discount) has nothing to reverse, and a 0
  // entry would only clutter the ledger.
  const took = Number(sale.total || 0);
  if (took) {
    stmts.push(db.prepare(
      `INSERT INTO coffer_entries (realm_id, business, ts, kind, amount, note) VALUES (?, ?, ?, 'void', ?, ?)`
    ).bind(realmId, business, new Date().toISOString(), -took, 'Void ' + order));
  }
  await db.batch(stmts);
  return { ok: true, orderNo: order };
}
