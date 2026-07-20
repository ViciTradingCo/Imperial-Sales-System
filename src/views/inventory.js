/**
 * Inventory page.
 *   • Everyone in the business: view items (price / stock / status).
 *   • Owner/admin: record intake (a purchase transaction — vendor, hold,
 *     quantity, $ per item — which logs the buy and adds stock), edit an item's
 *     sale price + low-stock threshold (via a focus modal opened from Edit), and
 *     remove items. Recent intake is listed for reference.
 * New items are created by recording intake; the edit modal only adjusts an
 * existing item's details.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { openModal } from '../lib/modal.js';
import { money } from '../lib/format.js';
import { setOpsActions } from '../lib/sections.js';

export function renderInventory(container, { me }) {
  const canEdit = me.role === 'owner' || me.role === 'admin';
  setOpsActions(me); // business-tools bar persists across Register/Inventory/Employees
  const listHost = el('div', {}, el('p', { class: 'note' }, 'Loading inventory…'));

  // The Record Intake button sits between the intro and the item list.
  const firstCard = [
    el('h2', {}, 'Inventory'),
    el('p', { class: 'note' }, esc(me.business || 'Your shop') +
      ' — items, prices, and stock. "Low" means at or below an item’s own Low Stock number.'),
  ];
  if (canEdit) {
    firstCard.push(el('div', { class: 'row-actions' }, [
      el('button.primary', { onclick: () => openIntakeModal(refreshAll) }, 'Record Intake'),
      el('button.secondary-btn', { onclick: () => openTransferModal(me, refreshAll) }, 'Transfer'),
    ]));
  }
  firstCard.push(listHost);
  const nodes = [el('div.card', {}, firstCard)];

  let intakeHost = null;
  if (canEdit) {
    intakeHost = el('div', {}, '');
    nodes.push(el('div.card', {}, [
      el('h3', {}, 'Recent intake'),
      intakeHost,
    ]));
  }

  mount(container, ...nodes);

  function renderList(items) {
    if (!items.length) { mount(listHost, el('p', { class: 'note' }, 'No items yet.')); return; }
    const rows = items.map((it) => {
      const meta = el('span', { html:
        '<b>' + esc(it.item) + '</b> · ' + money(it.price) +
        ' · ' + it.stock + ' in stock · ' + statusTag(it.status) });
      const row = el('div.emp-row', {}, [meta]);
      if (canEdit) {
        const edit = el('button.primary.small', { onclick: () => openItemModal(it, refreshInventory) }, 'Edit');
        const del = el('button.secondary-btn.small', {
          onclick: async () => {
            if (!confirm('Remove "' + it.item + '"?')) return;
            try { const res = await api.deleteItem(it.item); renderList(res.inventory || []); }
            catch (e) { alert(e.message || e); }
          },
        }, 'Remove');
        row.appendChild(el('span', { class: 'row-actions' }, [edit, del]));
      }
      return row;
    });
    mount(listHost, ...rows);
  }

  function renderIntake(list) {
    if (!intakeHost) return;
    if (!list.length) { mount(intakeHost, el('p', { class: 'note' }, 'No intake recorded yet.')); return; }
    mount(intakeHost, ...list.map((r) => el('div.emp-row', {}, [
      el('span', { html:
        '<b>' + esc(r.item) + '</b> ×' + r.numItems + ' @ ' + money(r.pricePer) +
        (r.hold ? ' · ' + esc(r.hold) : '') + (r.vendor ? ' · ' + esc(r.vendor) : '') +
        ' <span class="note">' + esc(shortDate(r.ts)) + '</span>' }),
    ])));
  }

  async function refreshInventory() {
    try { renderList((await api.getInventory()).inventory || []); }
    catch (e) { mount(listHost, el('p', { class: 'error' }, e.message || String(e))); }
  }
  async function refreshIntake() {
    if (!intakeHost) return;
    try { renderIntake((await api.getIntake()).intake || []); }
    catch (e) { mount(intakeHost, el('p', { class: 'error' }, e.message || String(e))); }
  }
  async function refreshAll() { await refreshInventory(); await refreshIntake(); }

  refreshInventory();
  refreshIntake();
}

function statusTag(s) {
  const cls = s === 'Out of Stock' ? 'bad' : s === 'Low' ? 'warn' : 'ok';
  return '<span class="' + cls + '">' + esc(s) + '</span>';
}
function shortDate(ts) {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

/** Focus modal to edit an existing item's sale price + low-stock threshold. */
function openItemModal(it, onSaved) {
  const price = el('input', { type: 'number', step: '0.01', min: '0', value: String(it.price) });
  const low = el('input', { type: 'number', step: '1', min: '0', value: String(it.lowStock || 0) });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save');

  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  let modal;
  async function doSave() {
    save.disabled = true;
    setStatus('Saving…', '');
    try {
      await api.saveItem({ item: it.item, price: price.value, lowStock: low.value || 0 });
      onSaved();
      modal.close();
    } catch (e) {
      save.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  modal = openModal([
    el('h3', {}, 'Edit ' + it.item),
    el('p', { class: 'note' }, 'Stock (' + it.stock + ') is set by intake and sales, not here.'),
    el('label', {}, 'Sale price'), price,
    el('label', {}, 'Low stock threshold'), low,
    save,
    status,
  ]);
}

/** Intake (restock) transaction as a focus modal. */
function openIntakeModal(onRecorded) {
  const item = el('input', { type: 'text', placeholder: 'Item name' });
  const vendor = el('input', { type: 'text', placeholder: 'Vendor (who you bought from)' });
  const hold = el('select', {}, el('option', { value: '' }, 'Select a hold…'));
  const qty = el('input', { type: 'number', step: '1', min: '1', placeholder: '# of items' });
  const per = el('input', { type: 'number', step: '0.01', min: '0', placeholder: 'gp per item' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doRecord }, 'Record intake');

  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  // Fill the hold dropdown.
  api.getHolds()
    .then((res) => (res.holds || []).forEach((h) => hold.appendChild(el('option', { value: h }, h))))
    .catch(() => { /* hold is optional */ });

  let modal;
  async function doRecord() {
    save.disabled = true;
    setStatus('Recording…', '');
    try {
      await api.recordIntake({
        item: item.value.trim(),
        vendor: vendor.value.trim(),
        hold: hold.value,
        numItems: qty.value,
        pricePer: per.value,
      });
      onRecorded();
      modal.close();
    } catch (e) {
      save.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  modal = openModal([
    el('h3', {}, 'Record intake (restock)'),
    el('p', { class: 'note' }, 'Log a purchase — this adds the stock and records what you paid and where. A new item name is created automatically.'),
    el('label', {}, 'Item'), item,
    el('label', {}, 'Vendor'), vendor,
    el('label', {}, 'Hold purchased in'), hold,
    el('label', {}, '# of items'), qty,
    el('label', {}, 'Price per item (gp)'), per,
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
  const item = el('select', {}, el('option', { value: '' }, 'Pick an item…'));
  const qty = el('input', { type: 'number', min: '1', step: '1', placeholder: 'Amount' });
  const toSel = el('select', {}, el('option', { value: '' }, 'Receiving company…'));
  const status = el('p', {});
  const send = el('button.primary', { onclick: doSend }, 'Confirm transfer');
  const pendingHost = el('div', {}, el('p', { class: 'note' }, 'Loading transfers…'));
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  // Populate the item dropdown from current stock, and the company dropdown.
  api.getInventory().then((inv) => {
    (inv.inventory || []).filter((it) => it.stock > 0).forEach((it) =>
      item.appendChild(el('option', { value: it.item }, it.item + ' (' + it.stock + ' in stock)')));
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

  async function doSend() {
    if (!item.value) { setStatus('Pick an item.', 'error'); return; }
    if (!toSel.value) { setStatus('Pick a receiving company.', 'error'); return; }
    const n = Math.floor(Number(qty.value));
    if (!n || n < 1) { setStatus('Enter an amount.', 'error'); return; }
    send.disabled = true;
    setStatus('Sending…', '');
    try {
      renderPending(await api.createTransfer({ toBusiness: toSel.value, item: item.value, qty: n }));
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
    el('label', {}, 'Item'), item,
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
