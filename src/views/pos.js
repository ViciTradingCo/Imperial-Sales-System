/**
 * Register (POS). Build a cart (item, qty, sold-for price), pick a customer,
 * hold, and optional discount, then complete the sale — which decrements stock
 * and logs the sale server-side. The sale is attributed to the signed-in
 * character. An expired certification blocks selling. Order lookup + void live
 * in a focus modal opened from the action bar.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { openModal } from '../lib/modal.js';
import { money } from '../lib/format.js';
import { setOpsActions } from '../lib/sections.js';

export function renderPos(container, { me }) {
  setOpsActions(me); // business-tools bar persists across Register/Inventory/Employees

  const banner = el('div', {});
  const body = el('div', {}, el('p', { class: 'note' }, 'Loading register…'));
  mount(container, el('div.card', {}, [el('h2', {}, 'Register — ' + esc(me.business || 'Your shop')), banner]), body);

  let inventory = [];
  let holds = [];
  let discounts = [];
  let style = {};
  let master = [];
  const cart = []; // [{ item, qty, price }]

  Promise.all([
    api.getCert(), api.getInventory(), api.getHolds(),
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
          '⚠ This shop’s East Empire certification is <b>EXPIRED</b> — sales are blocked until an admin renews it.' }));
      }
      renderSale(cert.status !== 'EXPIRED');
    })
    .catch((e) => mount(body, el('p', { class: 'error' }, e.message || String(e))));

  // Mirror the server's normalization so client hints match server resolution.
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

  function renderSale(canSell) {
    // Item search: a text box backed by a datalist of master + inventory names.
    const listId = 'itemlist-' + Math.random().toString(36).slice(2, 7);
    const datalist = el('datalist', { id: listId });
    const itemInput = el('input', { type: 'text', placeholder: 'Search item…', autocomplete: 'off' });
    itemInput.setAttribute('list', listId);
    const itemHint = el('p', { class: 'note' }, '');
    const qty = el('input', { type: 'number', min: '1', step: '1', value: '1' });
    const price = el('input', { type: 'number', min: '0', step: '0.01', placeholder: 'Sold for per item (gp)' });

    let invByNorm = new Map();
    let masterByNorm = new Map();
    function rebuildSuggestions() {
      invByNorm = new Map(inventory.map((it) => [norm(it.item), it]));
      masterByNorm = new Map(master.map((m) => [norm(m.name), m]));
      const names = new Set();
      master.forEach((m) => names.add(m.name));
      inventory.forEach((it) => names.add(it.item));
      datalist.innerHTML = '';
      names.forEach((n) => datalist.appendChild(el('option', { value: n })));
    }
    function resolveHint() {
      const key = norm(itemInput.value);
      const inv = invByNorm.get(key);
      const mas = masterByNorm.get(key);
      if (inv) { if (!price.value) price.value = String(inv.price); itemHint.textContent = inv.stock + ' in stock · your price ' + money(inv.price); }
      else if (mas) { if (!price.value) price.value = String(mas.baseValue); itemHint.textContent = 'Not in your inventory · master base ' + money(mas.baseValue); }
      else { itemHint.textContent = itemInput.value.trim() ? 'New item — not in the master index (will be flagged, excluded from market).' : ''; }
    }
    itemInput.addEventListener('input', () => { price.value = ''; resolveHint(); });
    rebuildSuggestions();
    const addBtn = el('button.secondary-btn', { onclick: addToCart }, 'Add to order');

    const cartHost = el('div', {}, el('p', { class: 'note' }, 'Cart is empty.'));

    const customer = el('input', { type: 'text', placeholder: 'Customer name (optional)' });
    const holdSel = el('select', {}, el('option', { value: '' }, 'Pick a hold…'));
    holds.forEach((h) => holdSel.appendChild(el('option', { value: h }, h)));
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

    function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

    function renderCart() {
      if (!cart.length) { mount(cartHost, el('p', { class: 'note' }, 'Cart is empty.')); return; }
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
      const item = itemInput.value.trim();
      if (!item) { setStatus('Enter an item.', 'error'); return; }
      const q = Math.floor(Number(qty.value));
      if (!q || q < 1) { setStatus('Enter a quantity.', 'error'); return; }
      let p = Number(price.value);
      // Default the price from inventory / master if it was left blank.
      if (!isFinite(p) || p < 0 || price.value === '') {
        const inv = invByNorm.get(norm(item));
        const mas = masterByNorm.get(norm(item));
        p = inv ? inv.price : (mas ? mas.baseValue : NaN);
      }
      if (!isFinite(p) || p < 0) { setStatus('Enter a sold-for price.', 'error'); return; }
      cart.push({ item, qty: q, price: p });
      itemInput.value = ''; qty.value = '1'; price.value = ''; itemHint.textContent = '';
      setStatus('', '');
      renderCart();
    }

    async function doCheckout() {
      if (!cart.length) { setStatus('Add at least one item.', 'error'); return; }
      if (!holdSel.value) { setStatus('Pick a hold.', 'error'); return; }
      complete.disabled = true;
      setStatus('Completing…', '');
      try {
        const res = await api.checkout({
          cart, customer: customer.value.trim(), hold: holdSel.value,
          discountName: discName.value.trim(), discountPercent: discPct.value,
        });
        cart.length = 0;
        renderCart();
        customer.value = ''; discName.value = ''; discPct.value = '';
        // Keep the hold selected for quick back-to-back sales.
        let msg = 'Sale complete ✓ — ' + res.orderNo + ' · ' + money(res.total);
        if (res.offInventory && res.offInventory.length) msg += ' · off-inventory: ' + res.offInventory.join(', ');
        if (res.newItems && res.newItems.length) msg += ' · new item flagged: ' + res.newItems.join(', ');
        setStatus(msg, 'ok');
        complete.disabled = false;
        // Refresh stock counts + item suggestions.
        api.getInventory().then((inv) => {
          inventory = inv.inventory || [];
          rebuildSuggestions();
        }).catch(() => {});
      } catch (e) {
        complete.disabled = false;
        setStatus(e.message || String(e), 'error');
      }
    }

    const lookupBtn = el('button.secondary-btn', { onclick: () => openLookupModal() }, 'Open Order Lookup');

    mount(body,
      el('div.card', {}, [
        el('h3', {}, 'Add to order'),
        el('label', {}, 'Item'), itemInput, datalist, itemHint,
        el('label', {}, 'Quantity'), qty,
        el('label', {}, 'Sold for per item (gp)'), price,
        addBtn,
      ]),
      // Customer Details sits above the Order tab…
      el('div.card', {}, [
        el('h3', {}, 'Customer Details'),
        el('label', {}, 'Customer'), customer,
        el('label', {}, 'Hold'), holdSel,
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
          '<span class="note">' + esc(s.items || '') + '</span><br>' +
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
