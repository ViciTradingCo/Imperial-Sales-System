/**
 * Master Item Index (admin) — the shared item library (canonical name + base
 * value) that the register and market measure against. Add, edit, and delete
 * items; search filters the list. Backed by the Core's index_Items_Master tab.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { openModal } from '../lib/modal.js';
import { money } from '../lib/format.js';
import { setAdminActions } from '../lib/sections.js';

export function renderItemIndex(container) {
  setAdminActions();
  const listHost = el('div', {}, el('p', { class: 'note' }, 'Loading items…'));
  const search = el('input', { type: 'search', placeholder: 'Search items…' });
  search.addEventListener('input', draw);
  let all = [];

  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    el('h2', {}, 'Master Item Index'),
    el('p', { class: 'note' }, 'The shared item library — canonical names and base values. The register ' +
      'and Market Analysis measure against these.'),
    el('button.primary', { onclick: () => openItemModal(null) }, 'Add item'),
    search,
    listHost,
  ]));

  function load() {
    api.getItems().then((r) => { all = r.items || []; draw(); })
      .catch((e) => mount(listHost, el('p', { class: 'error' }, e.message || String(e))));
  }

  function draw() {
    const q = search.value.trim().toLowerCase();
    const items = !q ? all : all.filter((it) => it.name.toLowerCase().includes(q));
    if (!items.length) { mount(listHost, el('p', { class: 'note' }, all.length ? 'No matches.' : 'No items yet.')); return; }
    mount(listHost, ...items.map((it) => el('div', { class: 'member-row' }, [
      el('p', { html: '<b>' + esc(it.name) + '</b> · <span class="note">base ' + esc(money(it.baseValue)) + '</span>' }),
      el('span', { class: 'row-actions' }, [
        el('button.primary.small', { onclick: () => openItemModal(it) }, 'Edit'),
        el('button.danger.small', { onclick: () => remove(it) }, 'Delete'),
      ]),
    ])));
  }

  async function remove(it) {
    if (!window.confirm('Delete "' + it.name + '" from the master index?')) return;
    try { all = (await api.deleteMasterItem(it.name)).items || []; draw(); }
    catch (e) { alert(e.message || e); }
  }

  function openItemModal(item) {
    const isEdit = !!item;
    const name = el('input', { type: 'text', value: item ? item.name : '', placeholder: 'e.g. Iron Sword' });
    const base = el('input', { type: 'number', min: '0', step: '0.01', value: item ? String(item.baseValue) : '', placeholder: 'Base value (gp)' });
    const status = el('p', {});
    const save = el('button.primary', { onclick: doSave }, isEdit ? 'Save changes' : 'Add item');
    function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

    let modal;
    async function doSave() {
      if (!name.value.trim()) { setStatus('Enter an item name.', 'error'); return; }
      save.disabled = true; setStatus('Saving…', '');
      try {
        const payload = { name: name.value.trim(), baseValue: base.value };
        if (isEdit) payload.oldName = item.name;
        all = (await api.saveMasterItem(payload)).items || [];
        draw();
        modal.close();
      } catch (e) { save.disabled = false; setStatus(e.message || String(e), 'error'); }
    }

    modal = openModal([
      el('h3', {}, isEdit ? 'Edit item' : 'New item'),
      el('label', {}, 'Item name'), name,
      el('p', { class: 'note' }, 'Use proper capitalization — this is the canonical spelling.'),
      el('label', {}, 'Base value'), base,
      save,
      status,
    ]);
  }

  load();
}
