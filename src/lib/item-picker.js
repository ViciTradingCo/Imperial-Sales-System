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
 *
 * `meta` is for what helps you CHOOSE — whether you hold any, mainly. Prices do
 * not belong here: every row reading "Iron Sword base 30gp" made the list harder
 * to scan for the name, which is the one thing it is for, and the price is
 * already on the field that asks for one.
 */
import { el, mount, esc } from './dom.js';

/** Loose normalization mirroring the server: case/punctuation/space-insensitive. */
function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * `allowFree` turns the picker from a chooser into a suggester.
 *
 * The default is strict, and should stay that way for items: free text there
 * fragments the index on typos, which is the whole reason this control exists.
 * But a VENDOR is not an item. Most suppliers in the fiction are an NPC smith or
 * a caravan with no account, so the field has to take a name nobody registered —
 * while still recognising the ones who are registered, because that is what
 * credits their shop for the supply. So: type anything, and if what you typed IS
 * a company, it counts as picking it.
 */
export function createItemPicker(opts) {
  const options = opts || {};
  let items = options.items || [];
  const limit = options.limit || 8;
  const meta = options.meta || (() => '');
  const allowFree = !!options.allowFree;

  let chosen = null;

  /** The entry the current text names exactly, if any. */
  function exactMatch() {
    const key = norm(input.value);
    return key ? items.find((it) => norm(it.name) === key) || null : null;
  }

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
      // In free-text mode an empty list is a normal outcome, not a dead end —
      // say what typing anyway will do rather than reporting a failure.
      const msg = allowFree
        ? (options.freeHint || 'No registered company by that name — it will be recorded as typed.')
        : (items.length ? 'No matching item in the index.' : 'The item index is empty — an admin must add items.');
      mount(list, el('p', { class: 'note item-picker-empty' }, msg));
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
    // …except that typing a registered name in full IS choosing it. Someone who
    // knows the supplier should not have to click a list to prove it.
    if (allowFree) {
      const exact = exactMatch();
      if (exact && options.onPick) { chosen = exact; options.onPick(exact); }
    }
    open();
  });
  input.addEventListener('focus', open);
  // Let a click on an option land before closing.
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Enter') {
      // In free-text mode Enter means "I have finished typing", so leave the
      // event alone for the form to act on and just get the list out of the way.
      if (allowFree) { close(); return; }
      e.preventDefault();
      const found = matches(input.value);
      if (found.length === 1) pick(found[0]); // unambiguous — accept it
      else open();
    }
  });

  return {
    el: wrap,
    // What was typed, in free-text mode; the canonical name otherwise.
    value: () => (chosen ? chosen.name : (allowFree ? input.value.trim() : '')),
    // The registered entry, if this names one. Resolved rather than remembered,
    // so typing a name in full counts as much as clicking it.
    selected: () => chosen || (allowFree ? exactMatch() : null),
    setItems: (next) => { items = next || []; },
    clear: () => { chosen = null; input.value = ''; close(); },
    focus: () => input.focus(),
  };
}
