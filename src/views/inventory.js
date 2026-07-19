/**
 * Inventory page.
 *   • Everyone in the business: view items (price / stock / status).
 *   • Owner/admin: record intake (a purchase transaction — vendor, hold,
 *     quantity, $ per item — which logs the buy and adds stock), edit an item's
 *     sale price + low-stock threshold, and remove items. Recent intake is
 *     listed for reference.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';

export function renderInventory(container, { me }) {
  const canEdit = me.role === 'owner' || me.role === 'admin';
  const listHost = el('div', {}, el('p', { class: 'note' }, 'Loading inventory…'));

  const nodes = [el('div.card', {}, [
    el('h2', {}, 'Inventory'),
    el('p', { class: 'note' }, esc(me.business || 'Your shop') +
      ' — items, prices, and stock. "Low" means at or below an item’s own Low Stock number.'),
    listHost,
  ])];

  let editor = null;
  let intakeForm = null;
  let intakeHost = null;

  if (canEdit) {
    intakeForm = intakeCard(refreshAll);
    editor = itemEditorCard(refreshInventory);
    intakeHost = el('div', {}, '');
    nodes.push(intakeForm.card, editor.card, el('div.card', {}, [
      el('h3', {}, 'Recent intake'),
      intakeHost,
    ]));
  }

  mount(container, ...nodes);

  function renderList(items) {
    if (!items.length) { mount(listHost, el('p', { class: 'note' }, 'No items yet.')); return; }
    const rows = items.map((it) => {
      const meta = el('span', { html:
        '<b>' + esc(it.item) + '</b> · $' + Number(it.price).toFixed(2) +
        ' · ' + it.stock + ' in stock · ' + statusTag(it.status) });
      const row = el('div.emp-row', {}, [meta]);
      if (canEdit) {
        const edit = el('button.primary.small', { onclick: () => editor.fill(it) }, 'Edit');
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
        '<b>' + esc(r.item) + '</b> ×' + r.numItems + ' @ $' + Number(r.pricePer).toFixed(2) +
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
  if (intakeForm) intakeForm.loadHolds();
}

function statusTag(s) {
  const cls = s === 'Out of Stock' ? 'bad' : s === 'Low' ? 'warn' : 'ok';
  return '<span class="' + cls + '">' + esc(s) + '</span>';
}
function shortDate(ts) {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

/** Intake (restock) transaction form. */
function intakeCard(onRecorded) {
  const item = el('input', { type: 'text', placeholder: 'Item name' });
  const vendor = el('input', { type: 'text', placeholder: 'Vendor (who you bought from)' });
  const hold = el('select', {}, el('option', { value: '' }, 'Select a hold…'));
  const qty = el('input', { type: 'number', step: '1', min: '1', placeholder: '# of items' });
  const per = el('input', { type: 'number', step: '0.01', min: '0', placeholder: '$ per item' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doRecord }, 'Record intake');

  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  async function loadHolds() {
    try {
      const res = await api.getHolds();
      (res.holds || []).forEach((h) => hold.appendChild(el('option', { value: h }, h)));
    } catch (e) { /* leave the placeholder; hold is optional */ }
  }

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
      item.value = ''; vendor.value = ''; qty.value = ''; per.value = ''; hold.value = '';
      setStatus('Recorded ✓ — stock updated.', 'ok');
      save.disabled = false;
      onRecorded();
    } catch (e) {
      save.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  const card = el('div.card', {}, [
    el('h3', {}, 'Record intake (restock)'),
    el('p', { class: 'note' }, 'Log a purchase — this adds the stock and records what you paid and where. A new item name is created automatically.'),
    el('label', {}, 'Item'), item,
    el('label', {}, 'Vendor'), vendor,
    el('label', {}, 'Hold purchased in'), hold,
    el('label', {}, '# of items'), qty,
    el('label', {}, '$ per item'), per,
    save,
    status,
  ]);
  return { card, loadHolds };
}

/** Item details editor (sale price + low-stock threshold). Stock is not set here. */
function itemEditorCard(onSaved) {
  const name = el('input', { type: 'text', placeholder: 'Item name' });
  const price = el('input', { type: 'number', step: '0.01', min: '0', placeholder: 'Sale price' });
  const low = el('input', { type: 'number', step: '1', min: '0', placeholder: 'Low stock (0 = never)' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save item');

  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  async function doSave() {
    save.disabled = true;
    setStatus('Saving…', '');
    try {
      await api.saveItem({ item: name.value.trim(), price: price.value, lowStock: low.value || 0 });
      name.value = ''; price.value = ''; low.value = '';
      setStatus('Saved ✓', 'ok');
      save.disabled = false;
      onSaved();
    } catch (e) {
      save.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  const card = el('div.card', {}, [
    el('h3', {}, 'Item details (sale price)'),
    el('p', { class: 'note' }, 'Set an item’s sale price and low-stock warning level. Stock comes from intake and sales, not here.'),
    el('label', {}, 'Item'), name,
    el('label', {}, 'Sale price'), price,
    el('label', {}, 'Low stock threshold'), low,
    save,
    status,
  ]);
  card.fill = (it) => {
    name.value = it.item; price.value = it.price; low.value = it.lowStock || 0;
    name.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  return { card, fill: (it) => card.fill(it) };
}
