/**
 * Master Item Index (admin) — the shared item library (canonical name + base
 * value) that the register and market measure against. Add, edit, and delete
 * items; search filters the list. Backed by the Core's index_Items_Master tab.
 */
import { el, mount, esc } from '../lib/dom.js';
import { toast } from '../lib/toast.js';
import { api } from '../lib/api.js';
import { skeletonRows } from '../lib/skeleton.js';
import { setAdminActions } from '../lib/sections.js';
import { navigate } from '../lib/router.js';
import { openModal } from '../lib/modal.js';
import { money } from '../lib/format.js';

export function renderItemIndex(container) {
  setAdminActions();
  const listHost = el('div', {}, skeletonRows(5));
  const search = el('input', { type: 'search', placeholder: 'Search items…' });
  search.addEventListener('input', draw);
  let all = [];

  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    el('h2', {}, 'Master Item Index'),
    el('p', { class: 'note' }, 'The shared item library — canonical names and base values. The register ' +
      'and Market Analysis measure against these.'),
    el('div', { class: 'row-actions' }, [
      el('button.primary', { onclick: () => openImportExportModal(load) }, 'Import/Export'),
      el('button.danger', { onclick: doPurge }, 'Purge index'),
    ]),
    search,
    listHost,
  ]));

  /**
   * Empties this realm's index. Deliberately a typed confirm rather than a
   * dialog: it removes every item at once and there is no undo, and the count
   * in the prompt is the last chance to notice you're in the wrong realm.
   *
   * Shop inventories are untouched — a shop's stock is its own record. Items
   * missing from the index just stop being offered by the picker and stop
   * counting toward Market Analysis.
   */
  async function doPurge() {
    if (!all.length) { toast('The index is already empty.', ''); return; }
    if (!window.confirm('PURGE THE ITEM INDEX?\n\nThis removes all ' + all.length + ' item(s) from this ' +
      'realm\'s index. Shop inventories and sales history are NOT affected — but the register will stop ' +
      'offering these items until the index is rebuilt.\n\nExport a copy first if you might want them back.')) return;
    const typed = window.prompt('Type PURGE (all caps) to confirm:');
    if (typed !== 'PURGE') { toast('Purge cancelled.', ''); return; }
    try {
      const r = await api.purgeItems();
      toast('Removed ' + r.purged + ' item(s) from the index.', 'ok');
      load();
    } catch (e) { toast(e.message || String(e), 'error'); }
  }

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

  function openImportExportModal(onImported) {
    const exportBox = el('textarea', { rows: '6', readonly: true });
    const importBox = el('textarea', { rows: '6', placeholder: 'Item, base value\n(one per line — “Item value” also works)' });
    const status = el('p', {});
    const reportHost = el('div', {});
    const previewBtn = el('button.primary', { onclick: doPreview }, 'Preview' );
    function setStatus(m, c) { status.className = c || ''; status.textContent = m; }

    api.getItems().then((r) => {
      exportBox.value = 'Item, Base Value\n' + (r.items || []).map((it) => it.name + ', ' + it.baseValue).join('\n');
    }).catch(() => {});

    async function doPreview() {
      const rows = parseItems(importBox.value);
      if (!rows.length) { setStatus('Nothing to import.', 'error'); return; }
      previewBtn.disabled = true; setStatus('Analyzing…', '');
      try { renderReport(await api.analyzeItems(rows)); setStatus('', ''); }
      catch (e) { setStatus(e.message || String(e), 'error'); }
      finally { previewBtn.disabled = false; }
    }

    function renderReport(a) {
      const create = a.create || [], update = a.update || [], typos = a.typos || [];
      const nodes = [el('p', { html: '<b>' + create.length + '</b> new · <b>' + update.length +
        '</b> to update · <b>' + typos.length + '</b> possible typo(s).' })];
      const choices = typos.map((t) => {
        const sel = el('select', {});
        sel.appendChild(el('option', { value: 'fix' }, 'Fix → update “' + t.suggestion + '”'));
        sel.appendChild(el('option', { value: 'new' }, 'Add as new “' + t.name + '”'));
        nodes.push(el('div.member-row', {}, [
          el('p', { html: '<b>' + esc(t.name) + '</b> (' + money(t.baseValue) + ') — did you mean <b>' + esc(t.suggestion) + '</b>?' }),
          sel,
        ]));
        return { t, sel };
      });
      nodes.push(el('button.primary', { onclick: () => doApply(a, choices) }, 'Apply import'));
      mount(reportHost, ...nodes);
    }

    async function doApply(a, choices) {
      const rows = [];
      (a.create || []).forEach((r) => rows.push({ name: r.name, baseValue: r.baseValue }));
      (a.update || []).forEach((r) => rows.push({ name: r.name, baseValue: r.baseValue }));
      choices.forEach(({ t, sel }) => rows.push({ name: sel.value === 'fix' ? t.suggestion : t.name, baseValue: t.baseValue }));
      setStatus('Applying…', '');
      try {
        const res = await api.importMasterItems(rows);
        setStatus('Imported / updated ' + (res.imported || 0) + ' item(s).', 'ok');
        mount(reportHost);
        onImported();
      } catch (e) { setStatus(e.message || String(e), 'error'); }
    }

    openModal([
      el('h3', {}, 'Import / Export items'),
      el('label', {}, 'Export — copy this'),
      exportBox,
      el('label', {}, 'Import — paste here'),
      el('p', { class: 'note' }, 'One item per line: “Item, base value”. Preview checks for typos first; recognized ' +
        'names (any casing/spacing) update — not duplicate.'),
      importBox,
      previewBtn,
      status,
      reportHost,
    ]);
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

/** Parses pasted lines into [{name, baseValue}] (comma-CSV, or "Name value"). */
function parseItems(text) {
  const out = [];
  String(text || '').split('\n').forEach((line) => {
    line = line.trim();
    if (!line) return;
    let name, value;
    if (line.includes(',')) {
      const parts = line.split(',');
      value = parts.pop().trim();
      name = parts.join(',').trim();
    } else {
      const toks = line.split(/\s+/);
      value = toks.pop();
      name = toks.join(' ');
    }
    if (name) out.push({ name, baseValue: value });
  });
  return out;
}
