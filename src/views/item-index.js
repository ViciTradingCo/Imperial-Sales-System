/**
 * Master Item Index (admin) — the shared item library (canonical names + base
 * values) that the register and Market Analysis measure against.
 *
 * The index is DIVIDED INTO TABLES BY TYPE, one tile per table: Weapons,
 * Potions, whatever this realm keeps. Opening a tile gives that table on its
 * own — add, edit, delete and import/export inside it, with nothing from the
 * other tables in the way.
 *
 * "Unsorted" is the DEFAULT table: it is where everything that predates the
 * split lives, where the whole-index import puts unflagged rows, and where a
 * removed table's items go. It always exists and cannot be renamed or removed.
 *
 * Each table also carries FLAGS — extra words an import line may use to be
 * sorted into it, for realms whose own sheets say "wep" where the table says
 * Weapons.
 *
 * Searching is the exception to the tiles: a search runs across EVERY table at
 * once and shows one flat result list, because "where did I file that?" is the
 * question the search is being asked.
 */
import { el, mount, esc, tableEl } from '../lib/dom.js';
import { toast } from '../lib/toast.js';
import { api } from '../lib/api.js';
import { skeletonRows } from '../lib/skeleton.js';
import { setAdminActions } from '../lib/sections.js';
import { navigate } from '../lib/router.js';
import { openModal } from '../lib/modal.js';
import { tileGrid, openFocalMenu } from '../lib/tiles.js';
import { money } from '../lib/format.js';

const UNSORTED = 'Unsorted';

/** A tile glyph per table, matched loosely by name so common types look right. */
const GLYPHS = [
  [/weapon|sword|blade|axe|bow/i, '⚔️'], [/armou?r|shield|helm/i, '🛡️'],
  [/potion|alchem|elixir/i, '🧪'], [/ingredient|food|produce|herb/i, '🌿'],
  [/book|scroll|tome|spell/i, '📜'], [/ore|ingot|smith|material/i, '⛏️'],
  [/gem|jewel|ring|amulet/i, '💎'], [/misc|other|sundr/i, '🧺'],
];
function glyphFor(type) {
  if (type === UNSORTED) return '🗃️';
  for (const [re, g] of GLYPHS) if (re.test(type)) return g;
  return '📦';
}

export function renderItemIndex(container) {
  setAdminActions();
  const listHost = el('div', {}, skeletonRows(5));
  const search = el('input', { type: 'search', placeholder: 'Search every table…' });
  search.addEventListener('input', draw);
  let all = [];
  let types = [{ name: UNSORTED, flags: [] }];

  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    el('h2', {}, 'Master Item Index'),
    el('p', { class: 'note' }, 'The shared item library, kept as one table per type of item. The register ' +
      'and Market Analysis measure against these.'),
    el('div', { class: 'row-actions' }, [
      el('button.primary', { onclick: () => openImportExport('') }, 'Import/Export all'),
      el('button.secondary-btn', { onclick: openTypesModal }, 'Manage tables'),
      el('button.danger', { onclick: () => doPurge('') }, 'Purge index'),
    ]),
    search,
    listHost,
  ]));

  const typeNames = () => types.map((t) => t.name);
  const itemsIn = (type) => all.filter((it) => (it.category || UNSORTED) === type);

  /**
   * Empties the whole index, or one table. Deliberately a typed confirm rather
   * than a dialog: there is no undo, and the count in the prompt is the last
   * chance to notice you're in the wrong realm — or the wrong table.
   *
   * Shop inventories are untouched — a shop's stock is its own record. Items
   * missing from the index just stop being offered by the picker and stop
   * counting toward Market Analysis.
   */
  async function doPurge(type) {
    const scope = type ? itemsIn(type) : all;
    const what = type ? 'the "' + type + '" table' : "this realm's index";
    if (!scope.length) { toast(type ? 'That table is already empty.' : 'The index is already empty.', ''); return; }
    if (!window.confirm('PURGE ' + (type ? '"' + type.toUpperCase() + '"?' : 'THE ITEM INDEX?') +
      '\n\nThis removes all ' + scope.length + ' item(s) from ' + what + '. Shop inventories and sales history ' +
      'are NOT affected — but the register will stop offering these items until they are added back.\n\n' +
      'Export a copy first if you might want them back.')) return;
    if (window.prompt('Type PURGE (all caps) to confirm:') !== 'PURGE') { toast('Purge cancelled.', ''); return; }
    try {
      const r = await api.purgeItems(type);
      all = r.items || [];
      toast('Removed ' + r.purged + ' item(s).', 'ok');
      draw();
    } catch (e) { toast(e.message || String(e), 'error'); }
  }

  function load() {
    api.getItems().then((r) => {
      all = r.items || [];
      types = (r.types || []).length ? r.types : [{ name: UNSORTED, flags: [] }];
      draw();
    }).catch((e) => mount(listHost, el('p', { class: 'error' }, e.message || String(e))));
  }

  function draw() {
    const q = search.value.trim().toLowerCase();
    if (q) { drawSearch(q); return; }
    if (!all.length && types.length <= 1) {
      mount(listHost, el('p', { class: 'note' }, 'No items yet — use Import/Export all to paste a list, or ' +
        'Manage tables to set up your types first.'));
      return;
    }
    mount(listHost, tileGrid(types.map((t) => {
      const n = itemsIn(t.name).length;
      return {
        key: 'itype:' + t.name,
        label: t.name,
        hint: n + ' item' + (n === 1 ? '' : 's'),
        glyph: glyphFor(t.name),
        onOpen: () => openTypeTable(t.name),
      };
    }), {}));
  }

  /** One flat list across every table — with the table each hit came from. */
  function drawSearch(q) {
    const hits = all.filter((it) => it.name.toLowerCase().includes(q));
    if (!hits.length) { mount(listHost, el('p', { class: 'note' }, 'No matches in any table.')); return; }
    const list = itemList(hits, { showType: true, redraw: () => drawSearch(q) });
    mount(listHost, el('p', { class: 'note' }, hits.length + ' match(es) across ' +
      new Set(hits.map((h) => h.category || UNSORTED)).size + ' table(s).'), list);
  }

  /** One table, opened as a focal menu — the whole index screen in miniature. */
  function openTypeTable(type) {
    openFocalMenu(type, (host) => {
      const rows = el('div', {});
      const redraw = () => {
        const items = itemsIn(type);
        mount(rows, items.length
          ? itemList(items, { redraw })
          : el('p', { class: 'note' }, 'This table is empty.'));
      };
      mount(host,
        el('p', { class: 'note' }, type === UNSORTED
          ? 'The default table — everything not filed under a type. Tick items and move them to sort this ' +
            'table out.'
          : 'Items filed as ' + type + '.'),
        el('div', { class: 'row-actions' }, [
          el('button.primary', { onclick: () => openItemModal(null, type, redraw) }, 'Add item'),
          el('button.secondary-btn', { onclick: () => openImportExport(type, redraw) }, 'Import/Export'),
          el('button.danger', { onclick: () => doPurge(type) }, 'Empty this table'),
        ]),
        rows);
      redraw();
    });
  }

  /**
   * A list of items with a tick box each and a "move selected to…" bar.
   *
   * Bulk re-filing is the operation the type split makes most likely: a realm
   * that imported everything before setting its tables up has one enormous
   * Unsorted table, and moving it item by item is the same work the import was
   * meant to save.
   */
  function itemList(items, opts) {
    const options = opts || {};
    const boxes = new Map();
    const dest = el('select', {});
    typeNames().forEach((t) => dest.appendChild(el('option', { value: t }, t)));
    const moveBtn = el('button.primary.small', { onclick: doMove }, 'Move selected');
    const count = el('span', { class: 'note' }, '');
    const all$ = el('input', { type: 'checkbox' });

    function selected() {
      return [...boxes.entries()].filter(([, b]) => b.checked).map(([name]) => name);
    }
    function sync() {
      const n = selected().length;
      count.textContent = n ? n + ' selected' : '';
      moveBtn.disabled = !n;
      all$.checked = n > 0 && n === boxes.size;
    }
    all$.addEventListener('change', () => { boxes.forEach((b) => { b.checked = all$.checked; }); sync(); });

    async function doMove() {
      const names = selected();
      if (!names.length) return;
      moveBtn.disabled = true;
      try {
        const r = await api.moveItems(names, dest.value);
        all = r.items || all;
        toast(r.moved + ' item(s) moved to ' + r.category + '.', 'ok');
        if (options.redraw) options.redraw();
        draw();
      } catch (e) { moveBtn.disabled = false; toast(e.message || String(e), 'error'); }
    }

    const rows = items.map((it) => {
      const cat = it.category || UNSORTED;
      const box = el('input', { type: 'checkbox' });
      box.addEventListener('change', sync);
      boxes.set(it.name, box);
      return el('div', { class: 'member-row' }, [
        el('span', { class: 'row-pick' }, [box]),
        el('p', { html: '<b>' + esc(it.name) + '</b> · <span class="note">base ' + esc(money(it.baseValue)) +
          (options.showType ? ' · ' + esc(cat) : '') + '</span>' }),
        el('span', { class: 'row-actions' }, [
          el('button.primary.small', { onclick: () => openItemModal(it, cat, options.redraw) }, 'Edit'),
          el('button.danger.small', { onclick: () => remove(it, options.redraw) }, 'Delete'),
        ]),
      ]);
    });

    sync();
    return el('div', {}, [
      el('div', { class: 'bulk-bar' }, [
        el('label', { class: 'bulk-all' }, [all$, el('span', {}, 'Select all')]),
        count,
        el('span', { class: 'row-actions' }, [el('span', { class: 'note' }, 'Move to'), dest, moveBtn]),
      ]),
      ...rows,
    ]);
  }

  async function remove(it, redraw) {
    if (!window.confirm('Delete "' + it.name + '" from the master index?')) return;
    try {
      all = (await api.deleteMasterItem(it.name)).items || [];
      if (redraw) redraw();
      draw();
    } catch (e) { toast(e.message || String(e), 'error'); }
  }

  /* ---- the tables themselves ---- */

  function openTypesModal() {
    openFocalMenu('Manage tables', (host) => {
      const rows = el('div', {});
      const name = el('input', { type: 'text', placeholder: 'e.g. Weapons', maxlength: '40' });
      const newFlags = el('input', { type: 'text', placeholder: 'Sorting flags, comma separated (optional)' });
      const status = el('p', {});
      const setStatus = (m, c) => { status.className = c || ''; status.textContent = m; };

      async function act(fn) {
        setStatus('Saving…', '');
        try { await fn(); setStatus('', ''); redraw(); draw(); }
        catch (e) { setStatus(e.message || String(e), 'error'); }
      }

      function redraw() {
        mount(rows, ...types.map((t) => {
          const n = itemsIn(t.name).length;
          const locked = t.name === UNSORTED; // the default table: no rename, no removal
          const flags = (t.flags || []).length ? 'flags: ' + t.flags.join(', ') : 'no extra flags';
          return el('div', { class: 'member-row' }, [
            el('p', { html: '<b>' + esc(t.name) + '</b> · <span class="note">' + n + ' item(s) · ' + esc(flags) +
              (locked ? ' · the default table' : '') + '</span>' }),
            el('span', { class: 'row-actions' }, [
              el('button.primary.small', { onclick: () => editFlags(t) }, 'Flags'),
              ...(locked ? [] : [
                el('button.secondary-btn.small', { onclick: () => rename(t.name) }, 'Rename'),
                el('button.danger.small', { onclick: () => drop(t.name, n) }, 'Remove'),
              ]),
            ]),
          ]);
        }));
      }

      /** Flags are what an import line may say INSTEAD of the table's name. */
      function editFlags(t) {
        const next = window.prompt('Sorting flags for "' + t.name + '" (comma separated).\n\n' +
          'An import line whose type says any of these files the item here — the table\'s own name always ' +
          'works too.', (t.flags || []).join(', '));
        if (next === null) return;
        act(async () => { types = (await api.updateItemType(t.name, { flags: next })).types || types; });
      }

      function rename(t) {
        const next = window.prompt('Rename the "' + t + '" table to:', t);
        if (!next || next === t) return;
        act(async () => {
          const r = await api.updateItemType(t, { newName: next });
          types = r.types || types;
          all = r.items || all;
        });
      }

      function drop(t, n) {
        if (!window.confirm('Remove the "' + t + '" table?\n\nIts ' + n + ' item(s) are NOT deleted — they move ' +
          'to ' + UNSORTED + '.')) return;
        act(async () => {
          const r = await api.deleteItemType(t);
          types = r.types || types;
          all = r.items || all;
          toast(r.moved + ' item(s) moved to ' + UNSORTED + '.', 'ok');
        });
      }

      mount(host,
        el('p', { class: 'note' }, 'Each table is one type of item. Removing a table never removes its items — ' +
          'they move to ' + UNSORTED + ', the default table.'),
        rows,
        el('label', {}, 'New table'),
        name,
        newFlags,
        el('button.primary', { onclick: () => {
          if (!name.value.trim()) { setStatus('Enter a type name.', 'error'); return; }
          act(async () => {
            types = (await api.addItemType(name.value, newFlags.value)).types || types;
            name.value = ''; newFlags.value = '';
          });
        } }, 'Add table'),
        status);
      redraw();
    });
  }

  /* ---- import / export ---- */

  /**
   * Import/Export for ONE table, or for the whole index when `into` is ''.
   *
   * The only difference is where an unflagged row lands: in a table it lands in
   * that table (you opened it there and said so), and in the whole-index one it
   * lands in Unsorted. An explicit type flag still wins either way, so a mixed
   * paste sorts itself even when made from inside one table.
   */
  function openImportExport(into, onImported) {
    const scope = into || '';
    const rowsFor = scope ? itemsIn(scope) : all;
    const exportBox = el('textarea', { rows: '6', readonly: true });
    const importBox = el('textarea', { rows: '6', placeholder: 'Item, base value, type\n(the type is optional — “Item value” also works)' });
    const status = el('p', {});
    const reportHost = el('div', {});
    const previewBtn = el('button.primary', { onclick: doPreview }, 'Preview');
    function setStatus(m, c) { status.className = c || ''; status.textContent = m; }

    // Export carries the type column, so an export re-imports into the same tables.
    exportBox.value = 'Item, Base Value, Type\n' +
      rowsFor.map((it) => it.name + ', ' + it.baseValue + ', ' + (it.category || UNSORTED)).join('\n');

    async function doPreview() {
      const rows = parseItems(importBox.value);
      if (!rows.length) { setStatus('Nothing to import.', 'error'); return; }
      previewBtn.disabled = true; setStatus('Analyzing…', '');
      try { renderReport(await api.analyzeItems(rows, scope)); setStatus('', ''); }
      catch (e) { setStatus(e.message || String(e), 'error'); }
      finally { previewBtn.disabled = false; }
    }

    /**
     * The whole import as ONE table: a row per line, saying where it lands and
     * what will happen to it. This used to be three summary counts plus a
     * separate widget per suspected typo, which meant the numbers and the
     * decisions were read in different places and neither showed a line's
     * destination.
     */
    function renderReport(a) {
      const create = a.create || [], update = a.update || [], typos = a.typos || [], newTypes = a.newTypes || [];
      const fresh = new Set(newTypes);
      const choices = [];

      const rowFor = (r, action) => [r.name, money(r.baseValue),
        r.type + (fresh.has(r.type) ? ' (new table)' : ''), action];

      const rows = [
        ...create.map((r) => rowFor(r, el('span', { class: 'ok' }, 'Add'))),
        ...update.map((r) => rowFor(r, el('span', {}, r.currentType && r.currentType !== r.type
          ? 'Update · move from ' + r.currentType
          : 'Update'))),
        // A suspected typo is the only row with a decision to make, so its
        // action cell is the control rather than a label.
        ...typos.map((t) => {
          const sel = el('select', {});
          sel.appendChild(el('option', { value: 'fix' }, 'Fix → “' + t.suggestion + '”'));
          sel.appendChild(el('option', { value: 'new' }, 'Add as new'));
          choices.push({ t, sel });
          return rowFor(t, sel);
        }),
      ];

      mount(reportHost,
        el('p', { html: '<b>' + rows.length + '</b> line(s): ' + create.length + ' new · ' + update.length +
          ' to update · ' + typos.length + ' possible typo(s)' +
          (newTypes.length ? ' · ' + newTypes.length + ' new table(s)' : '') + '.' }),
        el('div', { class: 'table-scroll' }, tableEl(['Item', 'Base value', 'Table', 'Action'], rows)),
        el('button.primary', { onclick: () => doApply(a, choices) }, 'Apply import'));
    }

    async function doApply(a, choices) {
      const rows = [];
      (a.create || []).forEach((r) => rows.push({ name: r.name, baseValue: r.baseValue, type: r.type }));
      (a.update || []).forEach((r) => rows.push({ name: r.name, baseValue: r.baseValue, type: r.type }));
      choices.forEach(({ t, sel }) => rows.push({
        name: sel.value === 'fix' ? t.suggestion : t.name, baseValue: t.baseValue, type: t.type,
      }));
      setStatus('Applying…', '');
      try {
        const res = await api.importMasterItems(rows, scope);
        all = res.items || all;
        types = res.types || types;
        setStatus('Imported / updated ' + (res.imported || 0) + ' item(s)' +
          ((res.typesAdded || []).length ? ', added ' + res.typesAdded.length + ' table(s)' : '') + '.', 'ok');
        mount(reportHost);
        if (onImported) onImported();
        draw();
      } catch (e) { setStatus(e.message || String(e), 'error'); }
    }

    openModal([
      el('h3', {}, scope ? 'Import / Export — ' + scope : 'Import / Export the whole index'),
      el('label', {}, 'Export — copy this'),
      exportBox,
      el('label', {}, 'Import — paste here'),
      el('p', { class: 'note' }, 'One item per line: “Item, base value, type”. The TYPE is the flag that sorts ' +
        'the item — it can be a table\'s name or any of its flags, and a flag matching nothing creates that ' +
        'table. Leave it off and a new item goes to ' + (scope || UNSORTED) +
        ', while an item already in the index stays where it is. Preview checks for typos first; recognized ' +
        'names (any casing/spacing) update — not duplicate.'),
      importBox,
      previewBtn,
      status,
      reportHost,
    ]);
  }

  /** Add or edit one item. `type` preselects the table it is being added to. */
  function openItemModal(item, type, redraw) {
    const isEdit = !!item;
    const name = el('input', { type: 'text', value: item ? item.name : '', placeholder: 'e.g. Iron Sword' });
    const base = el('input', { type: 'number', min: '0', step: '0.01', value: item ? String(item.baseValue) : '', placeholder: 'Base value' });
    const cat = el('select', {});
    typeNames().forEach((t) => cat.appendChild(el('option', { value: t }, t)));
    cat.value = (item ? (item.category || UNSORTED) : (type || UNSORTED));
    const status = el('p', {});
    const save = el('button.primary', { onclick: doSave }, isEdit ? 'Save changes' : 'Add item');
    function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

    let modal;
    async function doSave() {
      if (!name.value.trim()) { setStatus('Enter an item name.', 'error'); return; }
      save.disabled = true; setStatus('Saving…', '');
      try {
        const payload = { name: name.value.trim(), baseValue: base.value, category: cat.value };
        if (isEdit) payload.oldName = item.name;
        all = (await api.saveMasterItem(payload)).items || [];
        if (redraw) redraw();
        draw();
        modal.close();
      } catch (e) { save.disabled = false; setStatus(e.message || String(e), 'error'); }
    }

    modal = openModal([
      el('h3', {}, isEdit ? 'Edit item' : 'New item'),
      el('label', {}, 'Item name'), name,
      el('p', { class: 'note' }, 'Use proper capitalization — this is the canonical spelling.'),
      el('label', {}, 'Base value'), base,
      el('label', {}, 'Table'), cat,
      save,
      status,
    ]);
  }

  load();
}

/**
 * Parses pasted lines into [{name, baseValue, type}].
 *
 * Comma form is "Name, value, type" — the value is the LAST numeric field, so a
 * name containing a comma still works and the type is whatever follows the
 * number. The space-separated form takes a trailing [Bracketed] tag as the type,
 * since a bare trailing word there is indistinguishable from part of the name.
 */
function parseItems(text) {
  const out = [];
  String(text || '').split('\n').forEach((line) => {
    line = line.trim();
    if (!line) return;
    let type = '';
    const tag = line.match(/\[([^\]]+)\]\s*$/);
    if (tag) { type = tag[1].trim(); line = line.slice(0, tag.index).trim(); }
    let name, value;
    if (line.includes(',')) {
      const parts = line.split(',').map((p) => p.trim());
      // The last field that reads as a number is the base value; anything after
      // it is the type flag, anything before it is the name.
      let at = -1;
      parts.forEach((p, i) => { if (p !== '' && isFinite(Number(p))) at = i; });
      if (at < 0) return; // no value on this line (a header row)
      value = parts[at];
      name = parts.slice(0, at).join(', ').trim();
      if (!type) type = parts.slice(at + 1).join(' ').trim();
    } else {
      const toks = line.split(/\s+/);
      value = toks.pop();
      name = toks.join(' ');
    }
    if (name) out.push({ name, baseValue: value, type });
  });
  return out;
}
