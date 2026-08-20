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
import { findBundle } from './bundles.js';
import { parseTags } from './inventory.js';
import { adjustmentLabel, MAX_UPCHARGE } from './discounts.js';

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
          if (name && isFinite(qty) && isFinite(price)) {
            const line = { name, qty, price };
            // Older rows have no parts; a bundle's do, and everything that puts
            // stock back reads them instead of the line's own name.
            if (Array.isArray(r.parts) && r.parts.length) {
              line.parts = r.parts
                .map((x) => ({ item: String((x && x.item) || '').trim(), qty: Math.floor(Number(x && x.qty)) || 0 }))
                .filter((x) => x.item && x.qty > 0);
            }
            out.lines.push(line);
          } else out.unparsed++;
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
  return JSON.stringify((lines || []).map((l) => (
    // `parts` rides along ONLY for a bundle. Without it a voided bundle sale
    // would try to put "Tavern Feast" back on the shelf — an item that does not
    // exist — and the ales and stews inside it would stay gone.
    l.parts && l.parts.length
      ? { name: l.name, qty: l.qty, price: l.price, parts: l.parts }
      : { name: l.name, qty: l.qty, price: l.price })));
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
 * What one bundle line costs, takes off the shelf, and records.
 *
 * Pulled out of checkout because it is a whole job of its own: a bundle is one
 * line to the customer and several to the stockroom, and every one of those
 * differences has a reason worth stating in one place.
 *
 * The price is the BUNDLE'S, read from the shop's own row — the caller resolves
 * it, and nothing here trusts the request for a figure.
 */
function bundleLine(b, askedQty, inv, rules) {
  const qty = Math.floor(Number(askedQty)) || 1;
  if (qty < 1) throw new Error('Bad quantity for ' + b.name + '.');
  if (!b.parts.length) throw new Error(b.name + ' has nothing in it.');

  const need = new Map();
  const offInventory = [];
  let floor = 0;
  let ceiling = null;
  let listed = 0; // what the parts come to at the shop's own prices

  for (const part of b.parts) {
    const held = inv[part.item.toLowerCase()];
    if (held && held.ingredient) {
      throw new Error(b.name + ' contains ' + held.item + ', which is marked as an ingredient — ' +
        'stock you craft with, not stock you sell.');
    }
    if (held) {
      need.set(held.item, (need.get(held.item) || 0) + part.qty * qty);
      listed += held.price * part.qty;
    } else {
      offInventory.push(part.item);
      // A flat-priced special can hold something the shop does not list — the
      // price is the special's either way. A PERCENTAGE cannot: there is no
      // figure to take a tenth off, and treating a missing listing as 0 would
      // quietly give the thing away.
      if (b.percentOff) {
        throw new Error(b.name + ' takes its price from what its items cost, and ' + part.item +
          ' is not in your inventory. Add it, or give the special a flat price.');
      }
    }
    // A Court's price controls apply to a bundle in AGGREGATE: it has no
    // per-item price to check, but selling ten capped items for one price must
    // not be a way around the cap.
    if (rules) {
      const cap = rules.prices.get(part.item.toLowerCase());
      if (cap && cap.min != null) floor += cap.min * part.qty;
      if (cap && cap.max != null && ceiling !== null) ceiling += cap.max * part.qty;
      else if (cap && cap.max == null) ceiling = null;
    }
  }
  // What ONE of them costs: the flat figure, or the shop's own prices for what
  // is in it with the special's percentage taken off. Worked out here rather
  // than stored, because it moves the moment an item is repriced — which is the
  // whole point of pricing a set this way.
  const unit = specialPrice(b, listed);
  if (rules && floor && unit < floor) {
    throw new Error(rules.hold + ' Court sets a floor of ' + floor + ' on what is in ' + b.name +
      ' — the bundle is priced at ' + unit + '.');
  }
  if (rules && ceiling !== null && ceiling && unit > ceiling) {
    throw new Error(rules.hold + ' Court caps what is in ' + b.name + ' at ' + ceiling +
      ' — the bundle is priced at ' + unit + '.');
  }

  return {
    need,
    offInventory,
    subtotal: unit * qty,
    // The UNITS that actually left the shelf. A bundle of ten sold once moved
    // ten things, and the shop's "items sold" should say so.
    qtyTotal: b.units * qty,
    line: { name: b.name, qty, price: unit, parts: b.parts },
  };
}

/**
 * What one of a special costs: its flat price, or the percentage off.
 *
 * `listed` is what its items come to at the shop's own prices. Not rounded
 * here — the intermediate arithmetic stays exact and only the settled total is
 * made a whole coin, so a 10% discount on three lines does not lose a coin per
 * line on its way to the till.
 */
function specialPrice(b, listed) {
  return b.percentOff ? listed * (100 - b.percentOff) / 100 : b.price;
}

/**
 * A special that asks for KINDS — "five food and five drink" — once the till
 * has said which items fill it.
 *
 * The shape of the trust is the same as everywhere else: the client chooses
 * WHAT (the customer picked the mead, not the shop) and the Worker checks the
 * choice and states the PRICE. Each chosen line says which requirement it
 * fills, so an item tagged both food and drink cannot quietly pay for both
 * halves of the deal — and the count has to be EXACT, since "five food" sold
 * for a flat price stops meaning anything if six will do.
 *
 * What it returns is an ordinary bundle line: one line to the customer, its
 * chosen parts riding along so the stockroom and any later void know what
 * actually left the shelf.
 */
function tagSpecialLine(b, askedQty, chosen, inv, rules) {
  /**
   * ONE AT A TIME, and this is where that rule is enforced rather than merely
   * observed by the register.
   *
   * A stored line's parts are PER UNIT of the special — everything that puts
   * stock back multiplies them by the line's quantity — and two of these need
   * not divide evenly: seven sweet rolls and three stews is a perfectly good
   * way to fill "five food" twice, and there is no per-special half of it.
   * Two specials are two lines, each with what its own customer chose.
   */
  const qty = Math.floor(Number(askedQty)) || 1;
  if (qty !== 1) {
    throw new Error(b.name + ' is filled at the till, so it is rung up one at a time — add it again for another.');
  }

  const picked = (Array.isArray(chosen) ? chosen : [])
    .map((p) => ({
      item: String((p && p.item) || '').trim(),
      qty: Math.floor(Number(p && p.qty)) || 0,
      tag: String((p && p.tag) || '').trim().toLowerCase(),
    }))
    .filter((p) => p.item && p.qty > 0);
  if (!picked.length) throw new Error('Choose what goes in ' + b.name + '.');

  const need = new Map();
  const parts = [];
  const filled = new Map(); // tag → units chosen against it
  let floor = 0;
  let ceiling = 0;
  let listed = 0; // what the choice comes to at the shop's own prices
  let capped = true; // every part has a ceiling, so the aggregate one means something

  for (const p of picked) {
    const held = inv[p.item.toLowerCase()];
    // Unlike a fixed bundle, a kind can only be filled from stock the shop
    // LISTS: the tag lives on the listing, so an item it does not stock has no
    // kind here and nothing to check against.
    if (!held) throw new Error(p.item + ' is not in your inventory, so it cannot fill ' + b.name + '.');
    if (held.ingredient) {
      throw new Error(b.name + ' cannot be filled with ' + held.item + ' — it is marked as an ingredient, ' +
        'stock you craft with rather than sell.');
    }
    if (!p.tag) throw new Error('Each choice in ' + b.name + ' must say which part of the deal it fills.');
    if (!held.tags.includes(p.tag)) {
      throw new Error(held.item + ' is not tagged "' + p.tag + '", so it cannot fill that part of ' + b.name + '.');
    }
    need.set(held.item, (need.get(held.item) || 0) + p.qty);
    parts.push({ item: held.item, qty: p.qty });
    listed += held.price * p.qty;
    filled.set(p.tag, (filled.get(p.tag) || 0) + p.qty);

    // The Court's floor and ceiling, in aggregate — the same rule a fixed
    // bundle follows, since neither has a per-item price to check.
    if (rules) {
      const cap = rules.prices.get(held.item.toLowerCase());
      if (cap && cap.min != null) floor += cap.min * p.qty;
      if (cap && cap.max != null) ceiling += cap.max * p.qty;
      else capped = false;
    }
  }

  for (const want of b.needs) {
    const got = filled.get(want.tag) || 0;
    if (got !== want.qty) {
      throw new Error(b.name + ' takes ' + want.qty + ' ' + want.tag + ' — ' + got + ' chosen.');
    }
  }
  // A tag chosen that the deal never asked for is a mistake at the till, not a
  // free extra: it would leave the shelf without being charged for.
  for (const tag of filled.keys()) {
    if (!b.needs.some((n) => n.tag === tag)) {
      throw new Error(b.name + ' does not ask for anything tagged "' + tag + '".');
    }
  }

  const price = specialPrice(b, listed);
  if (rules && floor && price < floor) {
    throw new Error(rules.hold + ' Court sets a floor of ' + floor + ' on what was chosen for ' + b.name +
      ' — the special is priced at ' + price + '.');
  }
  if (rules && capped && ceiling && price > ceiling) {
    throw new Error(rules.hold + ' Court caps what was chosen for ' + b.name + ' at ' + ceiling +
      ' — the special is priced at ' + price + '.');
  }

  return {
    need,
    offInventory: [],
    subtotal: price,
    qtyTotal: parts.reduce((n, p) => n + p.qty, 0),
    line: { name: b.name, qty: 1, price, parts },
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
  const { results } = await db.prepare('SELECT item, price, stock, ingredient, tags FROM inventory WHERE realm_id = ? AND business = ?')
    .bind(realmId, business).all();
  const inv = {};
  (results || []).forEach((r) => {
    inv[r.item.toLowerCase()] = {
      item: r.item, price: r.price, stock: r.stock, ingredient: !!r.ingredient,
      // What KIND of thing it is, for a special that asks for kinds rather than
      // naming items. Read here so the check happens against the shop's own
      // listing and never against anything the till claims.
      tags: parseTags(r.tags),
    };
  });

  const need = {};            // in-inventory items → stock decrements
  const lines = [];
  const offInventory = [];    // sold but not in this shop's inventory
  const newItems = [];        // not in the master index → excluded from market
  let subtotal = 0;
  let qtyTotal = 0;
  for (const line of cart) {
    // A BUNDLE LINE — several items, one price. Worked out in full by
    // bundleLine below, which is where the reasoning about it lives.
    if (line.bundle) {
      const b = await findBundle(env, business, line.bundle, realmId);
      if (!b) throw new Error('"' + line.bundle + '" is not one of this shop\'s bundles.');
      // Two kinds of special: one that names its items, and one that asks for
      // kinds and is filled at the till. The row says which it is.
      const priced = b.needs.length
        ? tagSpecialLine(b, line.qty, line.parts, inv, rules)
        : bundleLine(b, line.qty, inv, rules);
      priced.need.forEach((qty, item) => { need[item] = (need[item] || 0) + qty; });
      offInventory.push(...priced.offInventory);
      subtotal += priced.subtotal;
      qtyTotal += priced.qtyTotal;
      // Deliberately NOT added to newItems: a bundle is not an item and must
      // never find its way into the realm's master index.
      lines.push(priced.line);
      continue;
    }

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

  // `discountPercent` is a SIGNED adjustment: positive takes money off,
  // negative puts it on. One number and one sum, so an upcharge cannot be the
  // case some later branch forgot to handle. The wire name is unchanged on
  // purpose — a sale sitting in somebody's offline queue from before upcharges
  // existed still replays correctly.
  const pct = Number(discountPercent);
  // An adjustment on nothing is nothing; an employee purchase ignores it rather
  // than recording a percentage that did no work.
  const inRange = pct >= -MAX_UPCHARGE && pct <= 100;
  const discPct = !staff && isFinite(pct) && pct !== 0 && inRange ? pct : 0;
  // The line arithmetic above is exact — fractional prices and percentages are
  // allowed to produce whatever they produce. It is settled to a whole coin
  // ONCE, here, at the end: rounding every line would compound the loss, and
  // rounding down at the total is the customer's favour, once. That favour
  // holds for an upcharge too, which is the right way for it to fall.
  const finalTotal = staff ? 0 : coin(discPct ? subtotal * (100 - discPct) / 100 : subtotal);
  const discountLabel = adjustmentLabel(discPct, discountName);

  const orderNo = newOrderNo(new Date());
  // Stored as data, not as a sentence: the denomination is applied when it is
  // shown, so renaming a realm's money never invalidates its history.
  const itemSummary = encodeSaleItems(lines);
  const ts = new Date().toISOString();
  const employee = caller.character || caller.email;
  // WHAT THE SELLER EARNS ON THIS SALE, worked out now and stored on the row.
  //
  // Read from the caller's own record, never from the request: the person at
  // the register must not be able to name their own percentage. Settled to a
  // whole coin once, on the sale total, because a sale is the thing an owner
  // and an employee can both point at — a payout that disagreed with the sum
  // of its sales is a payout nobody trusts.
  //
  // An employee purchase earns nothing: it took no money, so there is no share
  // of it to take.
  const commissionPct = staff ? 0 : Number(caller.commissionRate) || 0;
  const commission = commissionPct > 0 ? coin(finalTotal * commissionPct / 100) : 0;

  const stmts = [];
  for (const item in need) {
    stmts.push(db.prepare('UPDATE inventory SET stock = stock - ? WHERE realm_id = ? AND business = ? AND item = ?').bind(need[item], realmId, business, item));
  }
  stmts.push(db.prepare(
    `INSERT INTO sales (realm_id, business, ts, order_no, customer, hold, items, qty_total, total, employee, discount, status, idem, staff_purchase, employee_uid, commission)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)`
  ).bind(realmId, business, ts, orderNo, String(customer || '').trim() || (staff ? employee : 'Walk-in'),
    holdName, itemSummary, qtyTotal, finalTotal, employee, discountLabel, idem || null, staff ? 1 : 0,
    caller.uid || '', commission));
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
        await notePendingItem(env, { name, baseValue: line ? line.price : 0, by: actor, shop: business }, realmId);
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
  // A bundle goes back as the things that were actually taken off the shelf.
  const back = [];
  parsed.lines.forEach((l) => {
    if (l.parts && l.parts.length) l.parts.forEach((p) => back.push({ item: p.item, qty: p.qty * l.qty }));
    else back.push({ item: l.name, qty: l.qty });
  });
  const stmts = back.map((l) =>
    db.prepare('UPDATE inventory SET stock = stock + ? WHERE realm_id = ? AND business = ? AND item = ?').bind(l.qty, realmId, business, l.item)
  );
  // The commission goes with the money. A voided sale is not a sale, so it
  // cannot still be owed to whoever rang it up — and an already-settled one is
  // left alone, since taking back a wage that has been paid is not this
  // button's business.
  stmts.push(db.prepare(
    "UPDATE sales SET status = 'VOIDED', commission = CASE WHEN commission_paid = 1 THEN commission ELSE 0 END WHERE id = ?"
  ).bind(sale.id));
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
