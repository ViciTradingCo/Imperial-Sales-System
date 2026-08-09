/**
 * Master Item Index (admin) — the shared item library (canonical names + base
 * values) that the register and Market Analysis measure against.
 *
 * ONE TABLE, ON THE PAGE. Every item in the realm, sorted by name, with the
 * table it is filed under as a column. It used to be a grid of tiles — one per
 * type — each opening its own list in a focal menu, which meant that seeing
 * what the index CONTAINED took as many clicks as there were types, and that
 * comparing two items filed differently was impossible without closing one
 * window to open another. An index is a thing you read; reading it should not
 * require opening anything.
 *
 * The type division is still real and still matters — it routes imports and
 * groups the register's picker. It is now a COLUMN and a FILTER rather than a
 * wall: picking a table narrows the same list in place, and every action
 * (add, import, empty) follows whatever is currently in view.
 *
 * "Unsorted" is the DEFAULT table: it is where everything that predates the
 * split lives, where the whole-index import puts unflagged rows, and where a
 * removed table's items go. It always exists and cannot be renamed or removed.
 *
 * Each table also carries FLAGS — extra words an import line may use to be
 * sorted into it, for realms whose own sheets say "wep" where the table says
 * Weapons. Manage tables is still a focal menu: it is a settings screen, not
 * the index.
 */
import { el, mount, esc, tableEl } from '../lib/dom.js';
import { toast } from '../lib/toast.js';
import { api } from '../lib/api.js';
import { skeletonRows } from '../lib/skeleton.js';
import { setAdminActions } from '../lib/sections.js';
import { navigate } from '../lib/router.js';
import { openModal } from '../lib/modal.js';
import { openFocalMenu } from '../lib/tiles.js';
import { pager } from '../lib/paginate.js';
import { money } from '../lib/format.js';

const UNSORTED = 'Unsorted';
const ALL = '';          // the filter's "every table" value

/** Long enough that most realms never see a pager, short enough to stay quick. */
const PAGE_SIZE = 100;

export function renderItemIndex(container) {
  setAdminActions();
  const listHost = el('div', {}, skeletonRows(5));
  // The review queue sits ABOVE the table: it is the one thing on this page with
  // a queue behind it, and every day it goes unread more sales attach to a name
  // that may turn out to be a duplicate.
  const reviewHost = el('div', {});
  const search = el('input', { type: 'search', placeholder: 'Search every item…' });
  search.addEventListener('input', () => { page = 1; draw(); });
  // Which table is in view. '' is every table, which is where the page starts —
  // the whole point is that the index is readable without choosing first.
  const filter = el('select', {});
  filter.addEventListener('change', () => { page = 1; draw(); });
  const scopeNote = el('span', { class: 'note' }, '');
  let all = [];
  let types = [{ name: UNSORTED, flags: [] }];
  let page = 1;

  // The buttons act on WHAT IS IN VIEW. Filtering to Potions and pressing Add
  // should add a potion; pressing Empty should empty potions. Their labels say
  // which, so neither is a surprise.
  const addBtn = el('button.primary', { onclick: () => openItemModal(null, filter.value || UNSORTED) }, 'Add item');
  const ioBtn = el('button.secondary-btn', { onclick: () => openImportExport(filter.value) }, 'Import/Export');
  const purgeBtn = el('button.danger', { onclick: () => doPurge(filter.value) }, 'Purge index');

  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    el('h2', {}, 'Master Item Index'),
    el('p', { class: 'note' }, 'The shared item library the register and Market Analysis measure against. ' +
      'Every item is here; the Table column is how it is filed.'),
    el('div', { class: 'row-actions' }, [
      addBtn, ioBtn,
      el('button.secondary-btn', { onclick: openTypesModal }, 'Manage tables'),
      purgeBtn,
    ]),
    reviewHost,
    el('div', { class: 'index-filters' }, [search, filter, scopeNote]),
    listHost,
  ]));

  const typeNames = () => types.map((t) => t.name);
  const itemsIn = (type) => all.filter((it) => (it.category || UNSORTED) === type);
  const typeOf = (it) => it.category || UNSORTED;

  /** The rows the page is currently showing: the filter, then the search. */
  function inView() {
    const q = search.value.trim().toLowerCase();
    const scope = filter.value ? all.filter((it) => typeOf(it) === filter.value) : all;
    return q ? scope.filter((it) => it.name.toLowerCase().includes(q)) : scope;
  }

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
    drawReview();
  }

  /**
   * Items the register invented, waiting on a yes or no.
   *
   * Shown with what each might duplicate, because that is the decision: almost
   * every one of these is either a real new thing or a misspelling of something
   * already in the index, and telling them apart needs both names side by side.
   */
  function drawReview() {
    api.getPendingItems().then((r) => {
      const pending = r.pending || [];
      if (!pending.length) { mount(reviewHost); return; }
      mount(reviewHost, el('div.card', { class: 'card review-card' }, [
        el('h3', {}, '🆕 New from the register (' + pending.length + ')'),
        el('p', { class: 'note' }, 'Sold at a till before anyone added them here, so they were added ' +
          'automatically. Keep one that is genuinely new; remove one that duplicates an item you already ' +
          'have — the sales stay either way.'),
        ...pending.map(pendingRow),
      ]));
    }).catch(() => { mount(reviewHost); /* the queue is not worth an error banner */ });
  }

  function pendingRow(p) {
    const when = p.firstSeen ? new Date(p.firstSeen).toLocaleDateString() : '';
    // Who rang it up and where. The shop matters as much as the person: one
    // till producing most of the duplicates is a training answer, not a data one.
    const who = [p.firstBy, p.firstShop && 'at ' + p.firstShop].filter(Boolean).join(' ');
    const row = el('div.emp-row', {}, [
      el('span', { html:
        '<b>' + esc(p.name) + '</b> · ' + esc(money(p.baseValue)) +
        '<br><span class="note">' + esc([when, who && 'by ' + who].filter(Boolean).join(' · ')) + '</span>' +
        (p.looksLike.length
          ? '<br><span class="note warn">Looks like: ' + esc(p.looksLike.join(', ')) + '</span>'
          : '') }),
    ]);
    const keep = el('button.primary.small', {
      onclick: async () => {
        try { await api.approveItem(p.name); toast('"' + p.name + '" kept.', 'ok'); load(); }
        catch (e) { toast(e.message || String(e), 'error'); }
      },
    }, 'Keep');
    const drop = el('button.danger.small', {
      onclick: async () => {
        if (!confirm('Remove "' + p.name + '" from the index?\n\n' +
          (p.looksLike.length ? 'Do this if it duplicates: ' + p.looksLike.join(', ') + '.\n\n' : '') +
          'Sales already recorded against this name are kept — they simply stop being counted ' +
          'as their own item.')) return;
        try { await api.deleteMasterItem(p.name); toast('"' + p.name + '" removed.', 'ok'); load(); }
        catch (e) { toast(e.message || String(e), 'error'); }
      },
    }, 'Remove');
    row.appendChild(el('span', { class: 'row-actions' }, [keep, drop]));
    return row;
  }

  /**
   * The page: the filter's options, the count, and the one table.
   *
   * Everything here re-reads `all`, so any action that changes the index calls
   * this and the whole screen is consistent again — there is no second copy of
   * the list in a window somewhere to fall out of step.
   */
  function draw() {
    paintFilter();
    const rows = inView();
    const total = all.length;

    scopeNote.textContent = !total ? ''
      : rows.length === total ? total + ' item' + (total === 1 ? '' : 's')
        : rows.length + ' of ' + total;

    // The buttons name their scope, so "Purge index" can never quietly mean
    // "purge Potions" or the other way round.
    const scope = filter.value;
    addBtn.textContent = scope ? 'Add to ' + scope : 'Add item';
    ioBtn.textContent = scope ? 'Import/Export ' + scope : 'Import/Export all';
    purgeBtn.textContent = scope ? 'Empty ' + scope : 'Purge index';

    if (!total) {
      mount(listHost, el('p', { class: 'note' }, 'No items yet — use Import/Export to paste a list, or ' +
        'Add item to enter one.'));
      return;
    }
    if (!rows.length) {
      mount(listHost, el('p', { class: 'note' }, search.value.trim()
        ? 'No matches' + (scope ? ' in ' + scope : '') + '.'
        : 'The ' + scope + ' table is empty.'));
      return;
    }
    mount(listHost, itemTable(rows));
  }

  /** Keeps the filter's options in step with the tables, without losing the pick. */
  function paintFilter() {
    const want = filter.value;
    const opts = [[ALL, 'Every table']].concat(types.map((t) => {
      const n = itemsIn(t.name).length;
      return [t.name, t.name + ' (' + n + ')'];
    }));
    filter.innerHTML = '';
    opts.forEach(([v, label]) => filter.appendChild(el('option', { value: v }, label)));
    // A table removed while it was selected drops the view back to everything,
    // rather than filtering on a name that no longer exists and showing nothing.
    filter.value = opts.some(([v]) => v === want) ? want : ALL;
  }

  /**
   * THE table — every item in view, one row each, sorted by name.
   *
   * A real table rather than a stack of cards because the columns are the
   * point: scanning base values down a column is how a wrong one is spotted,
   * and that only works if they line up.
   *
   * Bulk re-filing lives here too. It is the operation the type split makes
   * most likely — a realm that imported everything before setting its tables up
   * has one enormous Unsorted table, and moving it item by item is the work the
   * import was meant to save.
   */
  function itemTable(rows) {
    const boxes = new Map();
    const dest = el('select', {});
    typeNames().forEach((t) => dest.appendChild(el('option', { value: t }, t)));
    const moveBtn = el('button.primary.small', { onclick: doMove }, 'Move selected');
    const count = el('span', { class: 'note' }, '');
    const all$ = el('input', { type: 'checkbox', title: 'Select all on this page' });

    const selected = () => [...boxes.entries()].filter(([, b]) => b.checked).map(([name]) => name);
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
        draw();
      } catch (e) { moveBtn.disabled = false; toast(e.message || String(e), 'error'); }
    }

    // Paged, because an index of a few thousand items would otherwise build a
    // few thousand rows of DOM to scroll past. Ticks apply to the page you can
    // see — selecting rows you are not looking at is not a thing to offer.
    const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
    const pg = pager(sorted.length, page, PAGE_SIZE, (n) => { page = n; draw(); });

    const body = sorted.slice(pg.start, pg.end).map((it) => {
      const cat = typeOf(it);
      const box = el('input', { type: 'checkbox' });
      box.addEventListener('change', sync);
      boxes.set(it.name, box);
      return [
        box,
        el('b', {}, it.name),
        money(it.baseValue),
        cat,
        el('span', { class: 'row-actions' }, [
          el('button.primary.small', { onclick: () => openItemModal(it, cat) }, 'Edit'),
          el('button.danger.small', { onclick: () => remove(it) }, 'Delete'),
        ]),
      ];
    });

    sync();
    return el('div', {}, [
      el('div', { class: 'bulk-bar' }, [
        el('label', { class: 'bulk-all' }, [all$, el('span', {}, 'Select all')]),
        count,
        el('span', { class: 'row-actions' }, [el('span', { class: 'note' }, 'Move to'), dest, moveBtn]),
      ]),
      el('div', { class: 'table-scroll' },
        tableEl(['', 'Item', 'Base value', 'Table', ''], body)),
      ...(pg.pages > 1 ? [pg.bar] : []),
    ]);
  }

  async function remove(it) {
    if (!window.confirm('Delete "' + it.name + '" from the master index?')) return;
    try {
      all = (await api.deleteMasterItem(it.name)).items || [];
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
   * Which one you get follows the FILTER — the button says so, because an
   * import that silently went somewhere other than what is on screen would be
   * discovered later, by someone else.
   *
   * The only difference is where an unflagged row lands: filtered to a table it
   * lands there (that is what the screen says you are looking at), and
   * unfiltered it lands in Unsorted. An explicit type flag still wins either
   * way, so a mixed paste sorts itself regardless.
   */
  function openImportExport(into) {
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
  function openItemModal(item, type) {
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
