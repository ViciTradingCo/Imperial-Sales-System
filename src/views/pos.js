/**
 * Register (POS). Build a cart (item, qty, sold-for price), pick a customer,
 * region, and optional discount, then complete the sale — which decrements stock
 * and logs the sale server-side. The sale is attributed to the signed-in
 * character. An expired certification blocks selling. Order lookup + void live
 * in a focus modal opened from the action bar.
 */
import { currency, money } from '../lib/format.js';
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { openModal } from '../lib/modal.js';
import { setOpsActions } from '../lib/sections.js';
import { newIdem } from '../lib/id.js';
import { enqueueSale, flushSales, queuedCount, isNetworkError } from '../lib/offline-queue.js';
import { createItemPicker } from '../lib/item-picker.js';
import { emptyState } from '../lib/empty.js';
import { toast } from '../lib/toast.js';

export function renderPos(container, { me }) {
  setOpsActions(me); // business-tools bar persists across Register/Inventory/Employees

  const banner = el('div', {});
  const offlineBar = el('div', {});
  const body = el('div', {}, el('p', { class: 'note' }, 'Loading register…'));
  mount(container, el('div.card', {}, [el('h2', {}, 'Register — ' + esc(me.business || 'Your shop')), banner]), offlineBar, body);

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
    const picker = createItemPicker({
      placeholder: 'Search the item index…',
      meta: (it) => {
        const inv = invByNorm.get(norm(it.name));
        return inv ? inv.stock + ' in stock · ' + money(inv.price) : 'base ' + money(it.baseValue);
      },
      onPick: (it) => {
        const inv = invByNorm.get(norm(it.name));
        price.value = String(inv ? inv.price : it.baseValue);
        itemHint.textContent = inv
          ? inv.stock + ' in stock · your price ' + money(inv.price)
          : 'Not in your inventory · master base ' + money(it.baseValue);
      },
    });
    function rebuildSuggestions() {
      invByNorm = new Map(inventory.map((it) => [norm(it.item), it]));
      picker.setItems(master);
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
    const discName = el('input', { type: 'text', placeholder: 'Discount name (optional)' });
    const discPct = el('input', { type: 'number', min: '0', max: '100', step: '1', placeholder: 'Discount % (optional)' });
    // Pick a saved discount to fill the fields (or leave blank for none / custom).
    const discSel = el('select', {}, el('option', { value: '' }, 'No discount / custom'));
    discounts.forEach((d) => discSel.appendChild(el('option', { value: d.id }, d.name + ' (' + d.percent + '%)')));
    discSel.addEventListener('change', () => {
      const d = discounts.find((x) => String(x.id) === discSel.value);
      discName.value = d ? d.name : '';
      discPct.value = d ? String(d.percent) : '';
    });

    const status = el('p', {});
    const complete = el('button.primary', { onclick: doCheckout }, 'Complete sale');
    if (!canSell) complete.disabled = true;

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
      rows.push(el('p', { html: '<b>Subtotal: ' + money(total) + '</b>' }));
      mount(cartHost, ...rows);
    }

    function addToCart() {
      const picked = picker.selected();
      if (!picked) { setStatus('Pick an item from the index — start typing and click a result.', 'error'); return; }
      const item = picked.name; // canonical spelling
      const q = Math.floor(Number(qty.value));
      if (!q || q < 1) { setStatus('Enter a quantity.', 'error'); return; }
      let p = Number(price.value);
      // Default the price from inventory / master if it was left blank.
      if (!isFinite(p) || p < 0 || price.value === '') {
        const inv = invByNorm.get(norm(item));
        p = inv ? inv.price : picked.baseValue;
      }
      if (!isFinite(p) || p < 0) { setStatus('Enter a sold-for price.', 'error'); return; }
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
        discountName: discName.value.trim(), discountPercent: discPct.value,
        idempotencyKey: idemKey,
      };
      try {
        const res = await api.checkout(sale);
        idemKey = null; // next order gets a fresh key
        cart.length = 0;
        renderCart();
        customer.value = ''; discName.value = ''; discPct.value = '';
        // Keep the hold selected for quick back-to-back sales.
        toast('Sale complete — ' + res.orderNo + ' · ' + money(res.total), 'ok');
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
          idemKey = null; cart.length = 0; renderCart();
          customer.value = ''; discName.value = ''; discPct.value = '';
          setStatus('📴 No connection — sale saved offline and will sync automatically.', 'ok');
          renderOfflineBar();
        } else {
          setStatus(e.message || String(e), 'error');
        }
      }
    }

    const lookupBtn = el('button.secondary-btn', { onclick: () => openLookupModal() }, 'Open Order Lookup');

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
        el('label', {}, 'Discount'), discSel,
        el('label', {}, 'Discount name'), discName,
        el('label', {}, 'Discount %'), discPct,
      ]),
      // …and the Complete Sale button lives on the Order tab.
      el('div.card', {}, [
        el('h3', {}, 'Order'),
        cartHost,
        complete,
        status,
      ]),
      // Order Lookup is its own card at the bottom.
      el('div.card', {}, [
        el('h3', {}, 'Order Lookup'),
        el('p', { class: 'note' }, 'Find a past sale by order number, customer, or employee — or void one.'),
        lookupBtn,
      ]),
    );
    renderCart();
  }
}

/** Order lookup + void, in a focus modal. */
function openLookupModal() {
  const q = el('input', { type: 'text', placeholder: 'Order #, customer, or employee' });
  const results = el('div', {}, el('p', { class: 'note' }, 'Loading recent sales…'));
  const search = el('button.secondary-btn', { onclick: run }, 'Search');

  async function run() {
    mount(results, el('p', { class: 'note' }, 'Searching…'));
    try {
      const res = await api.getSales(q.value.trim());
      renderResults(res.sales || []);
    } catch (e) {
      mount(results, el('p', { class: 'error' }, e.message || String(e)));
    }
  }

  function renderResults(sales) {
    if (!sales.length) { mount(results, el('p', { class: 'note' }, 'No matching orders.')); return; }
    mount(results, ...sales.map((s) => {
      const voided = String(s.status).toUpperCase() === 'VOIDED';
      const card = el('div', { class: 'lookup-card' }, [
        el('p', { html:
          '<b>' + esc(s.orderNo) + '</b>' + (voided ? ' <span class="bad">VOIDED</span>' : '') + '<br>' +
          money(s.total) + ' · ' + esc(s.customer || 'Walk-in') + ' · ' + esc(s.hold || '') + '<br>' +
          '<span class="note">' + esc(saleLines(s)) + '</span><br>' +
          '<span class="note">by ' + esc(s.employee || '') + (s.discount ? ' · ' + esc(s.discount) : '') + '</span>' }),
      ]);
      if (!voided) {
        card.appendChild(el('button.secondary-btn.small', {
          onclick: async () => {
            if (!confirm('Void ' + s.orderNo + '? This returns the items to stock.')) return;
            try { await api.voidSale(s.orderNo); run(); }
            catch (e) { alert(e.message || e); }
          },
        }, 'Void this sale'));
      }
      return card;
    }));
  }

  openModal([
    el('h3', {}, 'Order Lookup'),
    el('p', { class: 'note' }, 'Search by order number, customer, or employee — or leave blank for the latest sales.'),
    q, search, results,
  ]);
  run();
}

/**
 * A sale's lines, rendered in THIS realm's denomination. The server sends the
 * numbers; the unit is applied here, so renaming the money re-renders history
 * rather than invalidating it. Falls back to the stored text for any row too
 * old or too damaged to parse.
 */
function saleLines(s) {
  const lines = (s && s.lines) || [];
  if (!lines.length) return String((s && s.items) || '');
  return lines.map((l) => l.name + ' x' + l.qty + ' @ ' + money(l.price)).join(', ');
}
