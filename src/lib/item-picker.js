/**
 * Item picker — a search box bound to the Master Item Index. The user types, the
 * list narrows, and they CLICK a suggestion; free text is never accepted as an
 * item. This keeps every item reference canonical, so the market/index never
 * fragments on typos.
 *
 * Usage:
 *   const picker = createItemPicker({ items, placeholder, onPick });
 *   picker.el          → mount this (input + results list)
 *   picker.value()     → the chosen canonical name, or '' when nothing is chosen
 *   picker.selected()  → the chosen item object, or null
 *   picker.setItems(a) → replace the source list
 *   picker.clear()     → reset the field
 *   picker.focus()
 *
 * Each entry needs a `name`; anything else (price, stock, baseValue) is passed
 * through to onPick and may be shown via the optional `meta` formatter.
 */
import { el, mount, esc } from './dom.js';

/** Loose normalization mirroring the server: case/punctuation/space-insensitive. */
function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function createItemPicker(opts) {
  const options = opts || {};
  let items = options.items || [];
  const limit = options.limit || 8;
  const meta = options.meta || (() => '');

  let chosen = null;

  const input = el('input', {
    type: 'search', autocomplete: 'off', class: 'item-picker-input',
    placeholder: options.placeholder || 'Search items…',
  });
  const list = el('div', { class: 'item-picker-list' });
  list.hidden = true;
  const wrap = el('div', { class: 'item-picker' }, [input, list]);

  function matches(q) {
    const key = norm(q);
    if (!key) return items.slice(0, limit);
    const starts = [], contains = [];
    items.forEach((it) => {
      const n = norm(it.name);
      if (n.startsWith(key)) starts.push(it);
      else if (n.includes(key)) contains.push(it);
    });
    return starts.concat(contains).slice(0, limit);
  }

  function close() { list.hidden = true; list.innerHTML = ''; }

  function open() {
    const found = matches(input.value);
    if (!found.length) {
      mount(list, el('p', { class: 'note item-picker-empty' },
        items.length ? 'No matching item in the index.' : 'The item index is empty — an admin must add items.'));
      list.hidden = false;
      return;
    }
    mount(list, ...found.map((it) => {
      const m = meta(it);
      const row = el('button', {
        type: 'button', class: 'item-picker-opt',
        onclick: () => pick(it),
      }, [el('span', { html: '<b>' + esc(it.name) + '</b>' + (m ? ' <span class="note">' + esc(m) + '</span>' : '') })]);
      return row;
    }));
    list.hidden = false;
  }

  function pick(it) {
    chosen = it;
    input.value = it.name; // canonical spelling
    close();
    if (options.onPick) options.onPick(it);
  }

  input.addEventListener('input', () => {
    // Typing invalidates a previous choice — a selection must be re-clicked.
    if (chosen && input.value !== chosen.name) chosen = null;
    open();
  });
  input.addEventListener('focus', open);
  // Let a click on an option land before closing.
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const found = matches(input.value);
      if (found.length === 1) pick(found[0]); // unambiguous — accept it
      else open();
    }
  });

  return {
    el: wrap,
    value: () => (chosen ? chosen.name : ''),
    selected: () => chosen,
    setItems: (next) => { items = next || []; },
    clear: () => { chosen = null; input.value = ''; close(); },
    focus: () => input.focus(),
  };
}
