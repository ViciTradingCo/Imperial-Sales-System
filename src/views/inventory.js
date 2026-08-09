/**
 * Inventory — WHAT THE SHOP HOLDS, right now.
 *
 *   • Everyone in the business: view items — price, stock, status.
 *   • Owner/admin: correct a count by hand, edit an item's sale price and
 *     low-stock threshold, move stock to another company, remove a listing.
 *
 * CHANGING STOCK IS NOT HERE. Buying it, growing it, making it and selling it
 * are all the register, which is where a person stands when stock moves. This
 * page is the list you consult, and the only writing it does is CORRECTING that
 * list: a miscount, a wrong price, a listing that should not exist.
 *
 * Transfer is the exception that proves it — it moves stock to another company
 * rather than in or out of the world, which is an administrative act on the
 * list rather than a thing that happens at a counter.
 */
import { money } from '../lib/format.js';
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { skeletonRows } from '../lib/skeleton.js';
import { openModal } from '../lib/modal.js';
import { setOpsActions } from '../lib/sections.js';
import { newIdem } from '../lib/id.js';
import { createItemPicker } from '../lib/item-picker.js';
import { emptyState } from '../lib/empty.js';
import { toast } from '../lib/toast.js';

export function renderInventory(container, { me }) {
  const canEdit = me.role === 'owner' || me.role === 'admin';
  setOpsActions(me); // business-tools bar persists across Register/Inventory/Employees
  const listHost = el('div', {}, skeletonRows(4));

  const firstCard = [
    el('h2', {}, 'Inventory'),
    el('p', { class: 'note' }, (me.business || 'Your shop') +
      ' — items, prices, and stock. "Low" means at or below an item’s own Low Stock number. ' +
      'Bought, grew, made or sold something? All four are on the register.'),
  ];
  // Moving stock to another company rewrites the listing, so it stays with the
  // owner.
  if (canEdit) {
    firstCard.push(el('div', { class: 'row-actions' }, [
      el('button.secondary-btn', { onclick: () => openTransferModal(me, refreshInventory) }, 'Transfer'),
    ]));
  }
  firstCard.push(listHost);
  const nodes = [el('div.card', {}, firstCard)];

  mount(container, ...nodes);

  function renderList(items) {
    if (!items.length) {
      // No action button here: the toolbar is a few pixels above, and the empty
      // state was rendering a second one right under it.
      mount(listHost, emptyState({ glyph: '📦', title: 'No items yet',
        hint: canEdit
          ? 'Record a delivery on the register’s Buying side — or a crop under Harvest — and it will appear '
            + 'here with its price and stock.'
          : 'Nothing stocked yet.' }));
      return;
    }
    const rows = items.map((it) => {
      const meta = el('span', { html:
        '<b>' + esc(it.item) + '</b> · ' +
        // An ingredient is never sold, so its sale price says nothing. What you
        // need for one is what it COSTS — the figure you are about to spend the
        // next time you go and buy more.
        (it.ingredient
          ? '<span class="role-pill">Ingredient</span>' +
            (it.avgCost ? ' · bought at ' + money(it.avgCost) : '')
          : money(it.price)) +
        ' · ' + it.stock + ' in stock · ' + statusTag(it.status) });
      const row = el('div.emp-row', {}, [meta]);
      if (canEdit) {
        const edit = el('button.primary.small', { onclick: () => openItemModal(it, refreshInventory) }, 'Edit');
        const count = el('button.secondary-btn.small', { onclick: () => openStockModal(it, refreshInventory) }, 'Stock');
        const del = el('button.secondary-btn.small', {
          onclick: async () => {
            if (!confirm('Remove "' + it.item + '" from your inventory?\n\n' +
              'This deletes the listing and its sale price. An item with no stock left is kept on ' +
              'purpose — it stays priced and ready for the next delivery — so there is no need to ' +
              'remove it just because it hit zero.')) return;
            try { const res = await api.deleteItem(it.item); renderList(res.inventory || []); }
            catch (e) { alert(e.message || e); }
          },
        }, 'Remove');
        row.appendChild(el('span', { class: 'row-actions' }, [edit, count, del]));
      }
      return row;
    });
    mount(listHost, ...rows);
  }

  async function refreshInventory() {
    try { renderList((await api.getInventory()).inventory || []); }
    catch (e) { mount(listHost, el('p', { class: 'error' }, e.message || String(e))); }
  }
  refreshInventory();
}

function statusTag(s) {
  const cls = s === 'Out of Stock' ? 'bad' : s === 'Low' ? 'warn' : 'ok';
  return '<span class="' + cls + '">' + esc(s) + '</span>';
}

/** Focus modal to edit an existing item's sale price + low-stock threshold. */
function openItemModal(it, onSaved) {
  const price = el('input', { type: 'number', step: '0.01', min: '0', value: String(it.price) });
  const low = el('input', { type: 'number', step: '1', min: '0', value: String(it.lowStock || 0) });
  const ingredient = el('input', { type: 'checkbox' });
  ingredient.checked = !!it.ingredient;
  const priceWrap = el('div', {}, [
    el('label', {}, 'Sale price — the register’s default for this item'), price,
  ]);
  priceWrap.hidden = ingredient.checked;
  ingredient.addEventListener('change', () => { priceWrap.hidden = ingredient.checked; });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save');

  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  let modal;
  async function doSave() {
    save.disabled = true;
    setStatus('Saving…', '');
    try {
      await api.saveItem({
        item: it.item, price: price.value, lowStock: low.value || 0,
        ingredient: ingredient.checked,
      });
      onSaved();
      modal.close();
    } catch (e) {
      save.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  modal = openModal([
    el('h3', {}, 'Edit ' + it.item),
    el('p', { class: 'note' }, 'Stock (' + it.stock + ') is set by intake, sales and crafting, not here. ' +
      'An item with none left keeps its listing and its price.'),
    el('label', { class: 'check-row' }, [ingredient, el('span', {}, 'Ingredient — stock to craft with, not to sell')]),
    priceWrap,
    el('label', {}, 'Low stock threshold'), low,
    save,
    status,
  ]);
}

/**
 * Correcting an item's stock by hand.
 *
 * Every other path moves stock because something HAPPENED — a sale, a delivery,
 * a craft. This one exists because the shelf is the real authority: when the
 * count in the app disagrees with the count in the room, the room wins. Before
 * it, the only way to fix a wrong number was to invent an intake, which pushed
 * money through the coffer that nobody actually spent.
 *
 * It shows the current figure and takes the new one, rather than asking for a
 * difference — "there are 7" is what someone counting a shelf knows, and making
 * them work out "so that is minus 3" is how a correction becomes a second error.
 */
function openStockModal(it, onSaved) {
  const count = el('input', { type: 'number', step: '1', min: '0', value: String(it.stock) });
  const note = el('input', { type: 'text', placeholder: 'Why? (stocktake, breakage, spoilage…)' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Set stock');
  function setStatus(m, c) { status.className = c || ''; status.textContent = m; }

  let modal;
  async function doSave() {
    save.disabled = true;
    setStatus('Saving…', '');
    try {
      const res = await api.setStock(it.item, count.value, note.value);
      onSaved();
      modal.close();
      toast(it.item + ': ' + res.was + ' → ' + res.now + ' in stock.', 'ok');
    } catch (e) {
      save.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  modal = openModal([
    el('h3', {}, 'Stock — ' + it.item),
    el('p', { class: 'note' }, 'Currently ' + it.stock + ' in stock. Enter what is actually there.'),
    el('p', { class: 'note' }, 'This moves no money and records no purchase — it only corrects the count. ' +
      'For goods you actually bought, record an intake instead so the coffer matches.'),
    el('label', {}, 'Stock on hand'), count,
    el('label', {}, 'Note (optional)'), note,
    save,
    status,
  ]);
}

/**
 * Transfer goods to another company. Sending debits your stock immediately; the
 * goods only appear in the receiver's inventory once they accept (from the
 * incoming list here). Shows pending incoming (with Accept) and outgoing.
 */
function openTransferModal(me, onChanged) {
  // Transfers move YOUR stock, so the picker is bound to in-stock inventory
  // (already canonical names) rather than the whole master index.
  const picker = createItemPicker({
    placeholder: 'Search your stock…',
    meta: (it) => it.stock + ' in stock',
  });
  const qty = el('input', { type: 'number', min: '1', step: '1', placeholder: 'Amount' });
  const toSel = el('select', {}, el('option', { value: '' }, 'Receiving company…'));
  const status = el('p', {});
  const send = el('button.primary', { onclick: doSend }, 'Confirm transfer');
  const pendingHost = el('div', {}, el('p', { class: 'note' }, 'Loading transfers…'));
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  // Populate the item picker from current stock, and the company dropdown.
  api.getInventory().then((inv) => {
    picker.setItems((inv.inventory || []).filter((it) => it.stock > 0).map((it) => ({ name: it.item, stock: it.stock })));
  }).catch(() => {});
  api.getBusinesses().then((res) => {
    (res.businesses || []).filter((b) => b.toLowerCase() !== String(me.business || '').toLowerCase())
      .forEach((b) => toSel.appendChild(el('option', { value: b }, b)));
  }).catch(() => {});

  function renderPending(t) {
    const inc = t.incoming || [];
    const out = t.outgoing || [];
    const nodes = [];
    nodes.push(el('h3', {}, 'Incoming'));
    if (!inc.length) nodes.push(el('p', { class: 'note' }, 'No transfers waiting for you.'));
    else inc.forEach((x) => nodes.push(el('div.emp-row', {}, [
      el('span', { html: '<b>' + esc(x.item) + '</b> ×' + x.qty + ' <span class="note">from ' + esc(x.other) + '</span>' }),
      el('span', { class: 'row-actions' }, [
        el('button.primary.small', { onclick: () => act(() => api.acceptTransfer(x.id)) }, 'Accept'),
        el('button.danger.small', { onclick: () => act(() => api.declineTransfer(x.id)) }, 'Decline'),
      ]),
    ])));
    nodes.push(el('h3', {}, 'Outgoing (awaiting acceptance)'));
    if (!out.length) nodes.push(el('p', { class: 'note' }, 'None pending.'));
    else out.forEach((x) => nodes.push(el('div.emp-row', {}, [
      el('span', { html: '<b>' + esc(x.item) + '</b> ×' + x.qty + ' <span class="note">to ' + esc(x.other) + '</span>' }),
      el('button.danger.small', { onclick: () => act(() => api.cancelTransfer(x.id)) }, 'Cancel'),
    ])));
    mount(pendingHost, ...nodes);
  }

  function loadPending() {
    api.getTransfers().then(renderPending).catch((e) => mount(pendingHost, el('p', { class: 'error' }, e.message || String(e))));
  }

  const historyHost = el('div', {}, el('p', { class: 'note' }, 'Loading history…'));
  function loadHistory() {
    api.getTransferHistory().then((r) => {
      const h = r.history || [];
      if (!h.length) { mount(historyHost, el('p', { class: 'note' }, 'No transfer history yet.')); return; }
      mount(historyHost, ...h.map((x) => el('div.emp-row', {}, [
        el('span', { html: (x.dir === 'out' ? '→ ' : '← ') + '<b>' + esc(x.item) + '</b> ×' + x.qty +
          ' <span class="note">' + (x.dir === 'out' ? 'to ' + esc(x.to) : 'from ' + esc(x.from)) +
          ' · ' + esc(x.status) + '</span>' }),
      ])));
    }).catch((e) => mount(historyHost, el('p', { class: 'error' }, e.message || String(e))));
  }

  let sendKey = null; // stable across a retry of the same send; cleared on success
  async function doSend() {
    const picked = picker.selected();
    if (!picked) { setStatus('Pick an item from your stock.', 'error'); return; }
    if (!toSel.value) { setStatus('Pick a receiving company.', 'error'); return; }
    const n = Math.floor(Number(qty.value));
    if (!n || n < 1) { setStatus('Enter an amount.', 'error'); return; }
    if (!sendKey) sendKey = newIdem();
    send.disabled = true;
    setStatus('Sending…', '');
    try {
      renderPending(await api.createTransfer({ toBusiness: toSel.value, item: picked.name, qty: n, idempotencyKey: sendKey }));
      sendKey = null; // next transfer gets a fresh key
      setStatus('Transfer sent — awaiting acceptance.', 'ok');
      qty.value = '';
      loadHistory();
      onChanged(); // stock left our inventory
    } catch (e) {
      setStatus(e.message || String(e), 'error');
    } finally {
      send.disabled = false;
    }
  }

  // Accept / decline / cancel all move stock and refresh the same way.
  async function act(fn) {
    try {
      renderPending(await fn());
      loadHistory();
      onChanged(); // inventory changed (goods arrived, or returned to sender)
      window.dispatchEvent(new Event('eec:banners')); // refresh the pending banner
    } catch (e) {
      setStatus(e.message || String(e), 'error');
    }
  }

  loadPending();
  loadHistory();
  openModal([
    el('h3', {}, 'Transfer goods'),
    el('p', { class: 'note' }, 'Send stock to another company. It leaves your inventory now and appears in theirs once they accept.'),
    el('label', {}, 'Item'), picker.el,
    el('label', {}, 'Amount'), qty,
    el('label', {}, 'Receiving company'), toSel,
    send,
    status,
    el('hr', {}),
    pendingHost,
    el('hr', {}),
    el('h3', {}, 'Recent transfers'),
    historyHost,
  ]);
}
