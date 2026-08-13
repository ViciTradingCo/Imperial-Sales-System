/**
 * The register — a shop's till, in both directions.
 *
 * SELLING builds a cart (item, qty, sold-for price), picks a customer, region
 * and optional discount, then completes the sale — decrementing stock and
 * logging it server-side, attributed to the signed-in character. An expired
 * certification blocks it. Order lookup + void live in a focus modal opened
 * from the action bar.
 *
 * BUYING is the same counter pointed the other way — a delivery arriving, coin
 * leaving the coffer — and lives in `intake-form.js`.
 *
 * HARVEST and CRAFT are the other two ways stock changes, and live in
 * `produce.js`. All four were split between here and Inventory on the reasoning
 * that the register was for things that move COIN; that put the four things a
 * shop does to its stock in two different places. The register is now where
 * stock CHANGES, and Inventory is what the shop currently HOLDS.
 *
 * Each is a separate ROUTE rather than a tab that swaps the body, so Back
 * works, the address bar says which one you are on, and a half-built cart is
 * not silently thrown away by a click meant to check a delivery.
 */
import { currency, money, coins } from '../lib/format.js';
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { setOpsActions } from '../lib/sections.js';
import { navigate } from '../lib/router.js';
import { newIdem } from '../lib/id.js';
import { enqueueSale, flushSales, queuedCount, isNetworkError } from '../lib/offline-queue.js';
import { createItemPicker } from '../lib/item-picker.js';
import { emptyState } from '../lib/empty.js';
import { toast } from '../lib/toast.js';
import { renderBuying } from './intake-form.js';
import { renderHarvest, renderCraft } from './produce.js';

/** The register's sides, in the order stock travels: in, made, out. */
const MODES = [
  ['sell', 'Selling', '/pos'],
  ['buy', 'Buying', '/pos/buy'],
  ['harvest', 'Harvest', '/pos/harvest'],
  ['craft', 'Craft', '/pos/craft'],
];

/**
 * The context buttons. Rendered on EVERY side so the row is a fixed landmark
 * rather than a thing that appears on one screen and not another — the active
 * one is marked, and pressing it does nothing.
 */
function modeSwitch(mode) {
  return el('div', { class: 'mode-switch' }, MODES.map(([key, label, to]) => {
    const on = key === mode;
    return el('button', {
      type: 'button',
      class: 'mode-btn' + (on ? ' active' : ''),
      'aria-pressed': on ? 'true' : 'false',
      onclick: () => { if (!on) navigate(to); },
    }, label);
  }));
}

export function renderPos(container, { me, mode }) {
  setOpsActions(me); // business-tools bar persists across Register/Inventory/Employees

  const banner = el('div', {});
  const offlineBar = el('div', {});
  const body = el('div', {}, el('p', { class: 'note' }, 'Loading register…'));
  const header = el('div.card', {}, [
    el('h2', {}, 'Register — ' + (me.business || 'Your shop')),
    modeSwitch(mode),
    banner,
  ]);

  // Every side but Selling: no cart, no certification check (an expired shop
  // may still take a delivery or bring in a crop), and no offline queue — none
  // of these is queued, so a bar promising to sync one would be a lie.
  const OTHER_SIDES = {
    buy: renderBuying,
    harvest: renderHarvest,
    craft: renderCraft,
  };
  if (OTHER_SIDES[mode]) {
    const host = el('div', {});
    mount(container, header, host);
    OTHER_SIDES[mode](host, { me });
    return;
  }

  mount(container, header, offlineBar, body);

  // Offline queue status + replay. Sales that couldn't reach the API are held in
  // localStorage and flushed here (on load, on reconnect, or on demand).
  function renderOfflineBar(extra) {
    const n = queuedCount();
    if (!n && !extra) { mount(offlineBar); return; }
    const sync = el('button.secondary-btn.small', { onclick: () => syncQueue(true) }, 'Sync now');
    mount(offlineBar, el('div.card', { style: 'border-color:#c60' }, [
      el('p', { html: (n ? '📴 <b>' + n + '</b> sale' + (n === 1 ? '' : 's') + ' saved offline — will sync when back online.' : '')
        + (extra ? ' ' + esc(extra) : '') }),
      n ? el('div', { class: 'row-actions' }, [sync]) : el('span', {}),
    ]));
  }
  async function syncQueue(manual) {
    if (!queuedCount()) { if (manual) renderOfflineBar('Nothing to sync.'); return; }
    const res = await flushSales((sale) => api.checkout(sale), me);
    const parts = [];
    if (res.flushed) parts.push('Synced ' + res.flushed + ' sale' + (res.flushed === 1 ? '' : 's') + '.');
    // Held sales were rung up in a different realm or shop; they belong there,
    // and flush when that account next signs in.
    if (res.held) parts.push(res.held + ' held for another shop or realm.');
    renderOfflineBar(parts.join(' '));
  }
  if (!renderPos._online) { renderPos._online = true; window.addEventListener('online', () => syncQueue(false)); }
  renderOfflineBar();
  syncQueue(false);

  let inventory = [];
  let holds = [];
  let discounts = [];
  let style = {};
  let master = [];
  const cart = []; // [{ item, qty, price }]

  Promise.all([
    api.getCert(), api.getInventory(), api.getRegions(),
    api.getDiscounts().catch(() => ({ discounts: [] })),
    api.getStyle().catch(() => ({})),
    api.getItems().catch(() => ({ items: [] })),
  ])
    .then(([cert, inv, hs, dc, st, mi]) => {
      inventory = inv.inventory || [];
      holds = hs.holds || [];
      discounts = dc.discounts || [];
      style = st || {};
      master = mi.items || [];
      // Shop style: a tagline strip (coloured by the shop's accent) on the header.
      if (style.tagline) {
        const strip = el('p', { class: 'shop-tagline' }, style.tagline);
        if (style.accent) { strip.style.borderColor = style.accent; strip.style.color = style.accent; }
        banner.appendChild(strip);
      }
      if (cert.status === 'EXPIRED') {
        banner.appendChild(el('p', { class: 'warn', html:
          '⚠ This shop’s Vici Trading Co. certification is <b>EXPIRED</b> — sales are blocked until an admin renews it.' }));
      }
      renderSale(cert.status !== 'EXPIRED');
    })
    .catch((e) => mount(body, el('p', { class: 'error' }, e.message || String(e))));

  // Mirror the server's normalization so client hints match server resolution.
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

  function renderSale(canSell) {
    // Item entry is a narrowing search over the MASTER INDEX — the clerk picks a
    // canonical item, never free text, so sales can't fragment the index.
    const itemHint = el('p', { class: 'note' }, '');
    const qty = el('input', { type: 'number', min: '1', step: '1', value: '1' });
    const price = el('input', { type: 'number', min: '0', step: '0.01', placeholder: 'Sold for per item (' + currency() + ')' });

    let invByNorm = new Map();
    /**
     * The register can meet a NEW item.
     *
     * It used to demand a pick from the index, which is right for keeping the
     * index clean and wrong for the moment it actually matters: a customer is
     * standing there with something nobody has entered yet, and the choice was
     * to abandon the sale or ring it up under the wrong name. Now anything can
     * be typed, and a name the index does not know is added to it — flagged, so
     * an admin confirms it or removes it as a duplicate.
     */
    const picker = createItemPicker({
      allowFree: true,
      freeHint: 'Not in the index — selling it will add it, for an admin to check.',
      placeholder: 'Search the item index…',
      meta: (it) => {
        const inv = invByNorm.get(norm(it.name));
        // Stock and type only. Whether you HOLD any helps you choose; the price
        // does not, and it lands in the price field the moment you pick — see
        // the hint below the box.
        const type = it.category && it.category !== 'Unsorted' ? it.category : '';
        const held = inv ? inv.stock + ' in stock' : '';
        return [held, type].filter(Boolean).join(' · ');
      },
      onPick: (it) => {
        const inv = invByNorm.get(norm(it.name));
        price.value = String(inv ? inv.price : it.baseValue);
        // Say WHERE the price came from: your own listing (set on intake or in
        // Inventory → Edit) or, failing that, the index's base value.
        itemHint.textContent = inv
          ? inv.stock + ' in stock · your sale price ' + money(inv.price)
          : 'Not listed in your inventory · using the index base ' + money(it.baseValue);
      },
    });
    function rebuildSuggestions() {
      invByNorm = new Map(inventory.map((it) => [norm(it.item), it]));
      // Ingredients are stock this shop crafts with, not stock it sells, so
      // they are not offered. Only THIS shop's listing decides that — a master
      // item the shop doesn't stock is still perfectly sellable, and another
      // shop may trade in the very thing this one keeps as a material.
      picker.setItems(master.filter((it) => {
        const inv = invByNorm.get(norm(it.name));
        return !(inv && inv.ingredient);
      }));
    }
    rebuildSuggestions();
    const addBtn = el('button.secondary-btn', { onclick: addToCart }, 'Add to order');

    const cartHost = el('div', {}, emptyState({ glyph: '🧺', title: 'Cart is empty', hint: 'Search the item index above and add items to build the order.' }));

    const customer = el('input', { type: 'text', placeholder: 'Customer name (optional)' });
    // The region field is per-realm: a realm that doesn't trade regionally
    // switches it off (Realm Management → Network Settings) and the register
    // stops asking. `regionOn` also gates the validation below.
    const prefs = (me && me.prefs) || {};
    const regionOn = prefs.showRegion !== false;
    const regionLabel = prefs.regionLabel || 'Region';
    const holdSel = el('select', {}, el('option', { value: '' }, 'Pick a ' + regionLabel.toLowerCase() + '…'));
    holds.forEach((h) => holdSel.appendChild(el('option', { value: h }, h)));
    const holdWrap = el('div', {}, [el('label', {}, regionLabel), holdSel]);
    holdWrap.hidden = !regionOn;
    const discName = el('input', { type: 'text', placeholder: 'Name (optional)' });
    // DIRECTION AND MAGNITUDE, not a signed number to type. The sign is how an
    // adjustment is stored; asking a clerk to type a minus to charge MORE is
    // the sort of thing that gets got wrong at speed.
    const discDir = el('select', {}, [
      el('option', { value: 'off' }, 'Take off'),
      el('option', { value: 'on' }, 'Add on'),
    ]);
    const discPct = el('input', { type: 'number', min: '0', max: '1000', step: '1', placeholder: '% (optional)' });
    // The signed percent this sale carries: positive off, negative on.
    const adjustment = () => {
      const n = Math.abs(Number(discPct.value));
      if (!isFinite(n) || !n) return 0;
      return discDir.value === 'on' ? -n : n;
    };
    // Pick a saved adjustment to fill the fields (or leave blank for none / custom).
    const discSel = el('select', {}, el('option', { value: '' }, 'None / custom'));
    discounts.forEach((d) => discSel.appendChild(el('option', { value: d.id },
      d.name + ' (' + (d.percent < 0 ? '+' + Math.abs(d.percent) + '% upcharge' : '−' + d.percent + '%') + ')')));
    discSel.addEventListener('change', () => {
      const d = discounts.find((x) => String(x.id) === discSel.value);
      discName.value = d ? d.name : '';
      discPct.value = d ? String(Math.abs(d.percent)) : '';
      discDir.value = d && d.percent < 0 ? 'on' : 'off';
      renderCart();
    });
    discPct.addEventListener('input', () => renderCart());
    discDir.addEventListener('change', () => renderCart());

    /**
     * Employee purchase — staff taking stock, at no charge.
     *
     * It still rings up: the goods leave the shelf and the shop needs the
     * record. What it does NOT do is take money, credit the coffers, or count
     * toward anyone's figures — a free item priced at 0 would drag the item's
     * average down and make the shop look like it gave its stock away.
     *
     * Discounts are meaningless against it, so they are switched off while it
     * is ticked rather than silently ignored at the server.
     */
    const staffBox = el('input', { type: 'checkbox' });
    const staffWrap = el('label', { class: 'check-row' }, [
      staffBox,
      el('span', {}, 'Employee purchase — no charge'),
    ]);
    const status = el('p', {});
    const complete = el('button.primary', { onclick: doCheckout }, 'Complete sale');
    if (!canSell) complete.disabled = true;
    // Registered after `complete` exists, since it renames the button.
    staffBox.addEventListener('change', () => {
      const on = staffBox.checked;
      [discSel, discName, discPct, discDir].forEach((f) => { f.disabled = on; });
      if (on) { discSel.value = ''; discName.value = ''; discPct.value = ''; discDir.value = 'off'; }
      complete.textContent = on ? 'Record employee purchase' : 'Complete sale';
      renderCart();
    });

    // One idempotency key per order-in-progress, so a retried submit can't
    // ring the same sale up twice. Reset after a successful checkout.
    let idemKey = null;

    function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

    function renderCart() {
      if (!cart.length) { mount(cartHost, emptyState({ glyph: '🧺', title: 'Cart is empty', hint: 'Search the item index above and add items to build the order.' })); return; }
      const rows = cart.map((line, i) => el('div.emp-row', {}, [
        el('span', { html: '<b>' + esc(line.item) + '</b> ×' + line.qty + ' @ ' + money(line.price) +
          ' = ' + money(line.qty * line.price) }),
        el('button.secondary-btn.small', { onclick: () => { cart.splice(i, 1); renderCart(); } }, 'Remove'),
      ]));
      const total = cart.reduce((s, l) => s + l.qty * l.price, 0);
      // On an employee purchase the line prices still say what the goods are
      // worth; the total is what will actually be taken, which is nothing.
      if (staffBox.checked) {
        rows.push(el('p', { html: '<b>No charge</b> <span class="note">— employee purchase (would be ' +
          esc(money(total)) + ')</span>' }));
        mount(cartHost, ...rows);
        return;
      }
      // WHAT THE CUSTOMER ACTUALLY PAYS, not just what the goods add up to.
      // The subtotal alone was survivable while every adjustment took money
      // OFF; with an upcharge it understates the bill, and the figure the
      // clerk reads out has to be the figure that gets taken.
      const pct = adjustment();
      if (!pct) {
        rows.push(el('p', { html: '<b>Total: ' + money(total) + '</b>' }));
      } else {
        rows.push(el('p', { class: 'buy-sub', html: 'Subtotal: ' + esc(money(total)) }));
        rows.push(el('p', { class: 'buy-sub', html: (pct < 0 ? 'Upcharge +' : 'Discount −') +
          esc(String(Math.abs(pct))) + '% · ' +
          esc(money(Math.abs(coins(total * (100 - pct) / 100) - coins(total)))) }));
        rows.push(el('p', { class: 'buy-total', html: '<b>Total: ' + money(total * (100 - pct) / 100) + '</b>' }));
      }
      mount(cartHost, ...rows);
    }

    function addToCart() {
      const picked = picker.selected();
      // A picked item carries its canonical spelling; free text is taken as
      // typed, and the Worker adds it to the index flagged for review.
      const item = picked ? picked.name : picker.value();
      if (!item) { setStatus('Type an item, or pick one from the index.', 'error'); return; }
      const q = Math.floor(Number(qty.value));
      if (!q || q < 1) { setStatus('Enter a quantity.', 'error'); return; }
      let p = Number(price.value);
      // Default the price from inventory / master if it was left blank.
      if (!isFinite(p) || p < 0 || price.value === '') {
        const inv = invByNorm.get(norm(item));
        p = inv ? inv.price : (picked ? picked.baseValue : NaN);
      }
      // A new item has no price to fall back on — the sold-for figure is the
      // only evidence of what it is worth, so it has to be given.
      if (!isFinite(p) || p < 0) {
        setStatus(picked ? 'Enter a sold-for price.'
          : '"' + item + '" is new — enter what it sold for.', 'error');
        return;
      }
      if (!picked) toast('"' + item + '" is new. It will be added for an admin to check.', 'warn');
      if (!idemKey) idemKey = newIdem();
      cart.push({ item, qty: q, price: p });
      picker.clear(); qty.value = '1'; price.value = ''; itemHint.textContent = '';
      setStatus('', '');
      renderCart();
    }

    async function doCheckout() {
      if (!cart.length) { setStatus('Add at least one item.', 'error'); return; }
      if (regionOn && !holdSel.value) { setStatus('Pick a ' + regionLabel.toLowerCase() + '.', 'error'); return; }
      complete.disabled = true;
      setStatus('Completing…', '');
      // Snapshot the order so it can be queued verbatim if the network is down.
      const sale = {
        cart: cart.slice(), customer: customer.value.trim(), hold: holdSel.value,
        discountName: discName.value.trim(), discountPercent: adjustment(),
        staffPurchase: staffBox.checked,
        idempotencyKey: idemKey,
      };
      try {
        const res = await api.checkout(sale);
        idemKey = null; // next order gets a fresh key
        cart.length = 0;
        customer.value = ''; discName.value = ''; discPct.value = ''; discDir.value = 'off'; discSel.value = '';
        // Deliberately reset: the next order is a normal sale unless someone
        // says otherwise. A sticky "no charge" — or a sticky upcharge — is the
        // expensive kind of bug.
        staffBox.checked = false;
        staffBox.dispatchEvent(new Event('change'));
        renderCart();
        // Keep the hold selected for quick back-to-back sales.
        toast(res.staffPurchase
          ? 'Employee purchase recorded — ' + res.orderNo + ' · no charge'
          : 'Sale complete — ' + res.orderNo + ' · ' + money(res.total), 'ok');
        let msg = '';
        if (res.offInventory && res.offInventory.length) msg += 'Off-inventory: ' + res.offInventory.join(', ') + '. ';
        if (res.newItems && res.newItems.length) msg += 'New item flagged: ' + res.newItems.join(', ') + '.';
        setStatus(msg, msg ? 'warn' : '');
        complete.disabled = false;
        // Refresh stock counts + item suggestions.
        api.getInventory().then((inv) => {
          inventory = inv.inventory || [];
          rebuildSuggestions();
        }).catch(() => {});
      } catch (e) {
        complete.disabled = false;
        if (isNetworkError(e)) {
          // Offline — stash the sale (with its idem key) to replay on reconnect.
          enqueueSale(sale, me);
          idemKey = null; cart.length = 0;
          customer.value = ''; discName.value = ''; discPct.value = ''; discDir.value = 'off'; discSel.value = '';
          staffBox.checked = false;
          staffBox.dispatchEvent(new Event('change'));
          renderCart();
          setStatus('📴 No connection — sale saved offline and will sync automatically.', 'ok');
          renderOfflineBar();
        } else {
          setStatus(e.message || String(e), 'error');
        }
      }
    }


    mount(body,
      el('div.card', {}, [
        el('h3', {}, 'Add to order'),
        el('label', {}, 'Item'), picker.el, itemHint,
        el('label', {}, 'Quantity'), qty,
        el('label', {}, 'Sold for per item (gp)'), price,
        addBtn,
      ]),
      // Customer Details sits above the Order tab…
      el('div.card', {}, [
        el('h3', {}, 'Customer Details'),
        el('label', {}, 'Customer'), customer,
        holdWrap,
        staffWrap,
        el('label', {}, 'Discount or upcharge'), discSel,
        el('label', {}, 'What to call it'), discName,
        el('label', {}, 'Adjust the price'), el('div', { class: 'row-actions' }, [discDir, discPct]),
      ]),
      // …and the Complete Sale button lives on the Order tab.
      el('div.card', {}, [
        el('h3', {}, 'Order'),
        cartHost,
        complete,
        status,
      ]),
    );
    renderCart();
  }
}

