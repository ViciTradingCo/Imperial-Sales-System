/**
 * Inventory page (owner/admin edit; everyone in the business can view). Lists a
 * shop's items with price / stock / status, and lets owners add or edit an item
 * and remove one. Backed by D1 via the Worker.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';

export function renderInventory(container, { me }) {
  const canEdit = me.role === 'owner' || me.role === 'admin';
  const listHost = el('div', {}, el('p', { class: 'note' }, 'Loading inventory…'));
  const status = el('p', {});

  const editor = canEdit ? itemEditor(reload, setStatus) : null;

  mount(container, el('div.card', {}, [
    el('h2', {}, 'Inventory'),
    el('p', { class: 'note' }, esc(me.business || 'Your shop') +
      ' — items, prices, and stock. "Low" means at or below an item’s own Low Stock number.'),
    listHost,
    status,
    ...(editor ? [editor] : []),
  ]));

  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  async function reload() {
    try {
      const res = await api.getInventory();
      renderList(res.inventory || []);
    } catch (e) {
      mount(listHost, el('p', { class: 'error' }, e.message || String(e)));
    }
  }

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
            catch (e) { setStatus(e.message || String(e), 'error'); }
          },
        }, 'Remove');
        row.appendChild(el('span', { class: 'row-actions' }, [edit, del]));
      }
      return row;
    });
    mount(listHost, ...rows);
  }

  reload();
}

function statusTag(s) {
  const cls = s === 'Out of Stock' ? 'bad' : s === 'Low' ? 'warn' : 'ok';
  return '<span class="' + cls + '">' + esc(s) + '</span>';
}

/** The add/edit form. Returns the card element with a `.fill(item)` helper. */
function itemEditor(onSaved, setStatus) {
  const name = el('input', { type: 'text', placeholder: 'Item name' });
  const price = el('input', { type: 'number', step: '0.01', min: '0', placeholder: 'Price' });
  const stock = el('input', { type: 'number', step: '1', min: '0', placeholder: 'Stock' });
  const low = el('input', { type: 'number', step: '1', min: '0', placeholder: 'Low stock (0 = never)' });
  const save = el('button.primary', { onclick: doSave }, 'Save item');

  async function doSave() {
    save.disabled = true;
    setStatus('Saving…', '');
    try {
      await api.saveItem({
        item: name.value.trim(),
        price: price.value,
        stock: stock.value,
        lowStock: low.value || 0,
      });
      name.value = ''; price.value = ''; stock.value = ''; low.value = '';
      setStatus('Saved ✓', 'ok');
      save.disabled = false;
      onSaved();
    } catch (e) {
      save.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  const card = el('div', { class: 'inv-editor' }, [
    el('h3', {}, 'Add / edit item'),
    el('p', { class: 'note' }, 'Saving an existing item name updates it.'),
    el('label', {}, 'Item'), name,
    el('label', {}, 'Price'), price,
    el('label', {}, 'Stock'), stock,
    el('label', {}, 'Low stock threshold'), low,
    save,
  ]);
  card.fill = (it) => {
    name.value = it.item; price.value = it.price; stock.value = it.stock; low.value = it.lowStock || 0;
    name.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  return card;
}
