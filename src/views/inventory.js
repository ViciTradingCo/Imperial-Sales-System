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
import { money, itemTags, tagLabel } from '../lib/format.js';
import { el, mount, esc, tableEl } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { skeletonRows } from '../lib/skeleton.js';
import { openModal } from '../lib/modal.js';
import { backToHome } from '../lib/sections.js';
import { canManage } from '../lib/roles.js';
import { openTransferModal } from './transfers.js';
import { emptyState } from '../lib/empty.js';
import { toast } from '../lib/toast.js';
import { readCsvFile, rowsToStocktake } from '../lib/csv.js';

export function renderInventory(container, { me }) {
  const canEdit = canManage(me);
  // The list as last loaded. The Kinds screen asks about the whole shop at
  // once, so it opens on what is already on screen rather than fetching a
  // second copy of it.
  let current = [];
  const listHost = el('div', {}, skeletonRows(4));

  const firstCard = [
    backToHome(),
    el('h2', {}, 'Inventory'),
    el('p', { class: 'note' }, (me.business || 'Your shop') +
      ' — what you sell and what you craft with, in two tables. "Low" means at or below an ' +
      'item’s own Low Stock number. Bought, grew, made or sold something? All four are on the register.'),
  ];
  // Moving stock to another company rewrites the listing, so it stays with the
  // owner.
  if (canEdit) {
    firstCard.push(el('div', { class: 'row-actions' }, [
      el('button.secondary-btn', { onclick: () => openTransferModal(me, refreshInventory) }, 'Transfer'),
      el('button.secondary-btn', { onclick: () => openStocktakeModal(refreshInventory) }, 'Stocktake'),
      // Tagging is a question about a LIST — "which of these are food?" — so it
      // gets a screen that asks it that way rather than forty visits to Edit.
      el('button.secondary-btn', { onclick: () => openTagsModal(current, refreshInventory) }, 'Kinds'),
    ]));
  }
  firstCard.push(listHost);
  const nodes = [el('div.card', {}, firstCard)];

  mount(container, ...nodes);

  /**
   * TWO TABLES: what the shop SELLS, and what it CRAFTS WITH.
   *
   * They were one list with a pill on some rows, which meant scanning past your
   * ingredients to find your stock and past your stock to find your ingredients
   * — and the two do not even want the same columns. An ingredient is never
   * sold, so its sale price says nothing about it; the figure somebody
   * restocking needs is what it COSTS. A single table would have to carry both
   * columns and leave one of them blank on every row.
   *
   * The `ingredient` flag is per LISTING, not per item: one shop's ingredient is
   * another's stock-in-trade, which is why it could never live on the shared
   * item index. Move a row between the tables with Edit.
   */
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
    const rowActions = canEdit ? {
      edit: (it) => openItemModal(it, refreshInventory),
      stock: (it) => openStockModal(it, refreshInventory),
      remove: async (it) => {
        if (!confirm('Remove "' + it.item + '" from your inventory?\n\n' +
          'This deletes the listing and its sale price. An item with no stock left is kept on ' +
          'purpose — it stays priced and ready for the next delivery — so there is no need to ' +
          'remove it just because it hit zero.')) return;
        try { const res = await api.deleteItem(it.item); current = res.inventory || []; renderList(current); }
        catch (e) { alert(e.message || e); }
      },
    } : null;
    mount(listHost,
      itemTable('Stock', 'What your shop sells.', items.filter((it) => !it.ingredient), false,
        'Nothing to sell yet — everything you hold is marked as an ingredient.', rowActions),
      itemTable('Ingredients', 'What your shop crafts with. These are not for sale, so what matters is ' +
        'what they cost you, not what you would charge.', items.filter((it) => it.ingredient), true,
        'Nothing marked as an ingredient. Tick Ingredient on an item with Edit to move it here.', rowActions),
    );
  }

  async function refreshInventory() {
    try {
      current = (await api.getInventory()).inventory || [];
      renderList(current);
    } catch (e) { mount(listHost, el('p', { class: 'error' }, e.message || String(e))); }
  }
  refreshInventory();
}

/**
 * One of the two tables.
 *
 * `cost` swaps the money column: an asking price for stock, what it has
 * actually been bought at for ingredients. The harvest column appears only
 * where some row in THIS table has a rate, so a shop that does not buy from its
 * own people is not reading a column of blanks. `actions` is null for anyone
 * who may only look, which is also what drops the buttons column.
 */
function itemTable(title, note, rows, cost, emptyNote, actions) {
  const anyHarvest = rows.some((it) => it.harvestPay);
  const head = ['Item', cost ? 'Bought at' : 'Price', 'In stock', 'Status'];
  if (anyHarvest) head.push('Harvest pays');
  if (actions) head.push('');

  const body = rows.map((it) => {
    const cells = [
      // The kinds ride WITH the name: what a thing is is part of naming it,
      // and a column of its own would be mostly empty on most shops' rows.
      el('span', { html: '<b>' + esc(it.item) + '</b>' + tagPills(it.tags) }),
      // "Never bought" and "free" are different answers, and only one of them
      // is true — so an ingredient nobody has purchased says so rather than
      // showing 0.
      cost ? (it.avgCost ? money(it.avgCost) : '—') : money(it.price),
      String(it.stock),
      el('span', { html: statusTag(it.status) }),
    ];
    if (anyHarvest) cells.push(it.harvestPay ? money(it.harvestPay) : '—');
    if (actions) {
      cells.push(el('span', { class: 'row-actions' }, [
        el('button.primary.small', { onclick: () => actions.edit(it) }, 'Edit'),
        el('button.secondary-btn.small', { onclick: () => actions.stock(it) }, 'Stock'),
        // Danger, unlike the Remove that takes a line out of a form you are
        // still filling in: this one deletes a listing the shop actually holds.
        el('button.danger.small', { onclick: () => actions.remove(it) }, 'Remove'),
      ]));
    }
    return cells;
  });

  return el('div', { class: 'inv-table' }, [
    el('h3', {}, title + ' (' + rows.length + ')'),
    el('p', { class: 'note' }, note),
    rows.length
      ? el('div', { class: 'table-scroll' }, tableEl(head, body))
      : el('p', { class: 'note' }, emptyNote),
  ]);
}

function statusTag(s) {
  const cls = s === 'Out of Stock' ? 'bad' : s === 'Low' ? 'warn' : 'ok';
  return '<span class="' + cls + '">' + esc(s) + '</span>';
}

/** A listing's kinds, written in the realm's own spelling. */
function tagPills(tags) {
  return (tags || []).map((t) => ' <span class="pill tag">' + esc(tagLabel(t)) + '</span>').join('');
}

/**
 * The kind-picker on one listing: a dropdown that ADDS, and a chip per kind on
 * it, each with an ✕.
 *
 * It was a grid of tick-boxes — every kind the realm names, laid out at once —
 * which put a wall of twenty boxes in the middle of a form where the answer is
 * usually one word. A dropdown is the size of the answer instead of the size of
 * the vocabulary, and what the listing IS stays readable as a row of chips
 * rather than having to be found among the things it is not.
 *
 * A fixed vocabulary rather than a box to type in, either way. A special asks
 * for five DRINK, and "drinks" typed on one listing is a listing the deal
 * cannot see — the failure would be silent and would look like the special
 * being broken.
 */
function tagChooser(selected) {
  const chosen = (selected || []).map((t) => String(t).toLowerCase());
  const vocabulary = itemTags();
  // Anything the listing already carries that the realm has since dropped stays
  // on it, or saving from this screen would quietly strip it.
  const known = () => [...vocabulary.map((v) => v.toLowerCase()), ...chosen];

  const pick = el('select', {});
  const chips = el('div', { class: 'tag-chips' });
  const wrap = el('div', {}, [pick, chips]);

  function paint() {
    // The dropdown offers what this listing is NOT yet, so picking one is
    // always an addition and the list shortens as it is used up.
    const left = vocabulary.filter((v) => !chosen.includes(v.toLowerCase()));
    mount(pick, el('option', { value: '' }, left.length ? 'Add a kind…' : 'Every kind is already on it'),
      ...left.map((v) => el('option', { value: v.toLowerCase() }, v)));
    pick.disabled = !left.length;
    pick.value = '';

    mount(chips, ...(chosen.length
      ? chosen.map((t) => el('span', { class: 'pill tag tag-chip' }, [
        el('span', {}, tagLabel(t)),
        el('button', {
          type: 'button', class: 'tag-chip-x', 'aria-label': 'Remove ' + tagLabel(t),
          onclick: () => { chosen.splice(chosen.indexOf(t), 1); paint(); },
        }, '✕'),
      ]))
      : [el('span', { class: 'note' }, 'No kind set.')]));
  }
  pick.addEventListener('change', () => {
    if (!pick.value) return;
    if (!chosen.includes(pick.value)) chosen.push(pick.value);
    paint();
  });
  paint();

  return {
    node: known().length
      ? wrap
      : el('p', { class: 'note' }, 'This realm has not named any kinds of item yet — an admin sets them in Network Settings.'),
    value: () => chosen.slice(),
  };
}

/**
 * KINDS, across the whole shop: pick one, tick everything that is it.
 *
 * The other way round from the Edit modal, and deliberately — tagging is a
 * question about a list ("which of these are food?"), and answering it one
 * listing at a time means opening forty modals to say one thing. What is ticked
 * carries the kind and what is not, does not; nothing else on any row moves.
 */
function openTagsModal(items, onSaved) {
  const vocabulary = itemTags();
  const status = el('p', {});
  const setStatus = (m, c) => { status.className = c || ''; status.textContent = m || ''; };

  if (!vocabulary.length) {
    openModal([
      el('h3', {}, 'Kinds of item'),
      el('p', { class: 'note' }, 'This realm has not named any kinds of item yet. An admin sets them in ' +
        'Realm Management → Network Settings, and every shop in the realm can then tag its stock.'),
    ]);
    return;
  }

  const pick = el('select', {}, vocabulary.map((t) => el('option', { value: t.toLowerCase() }, t)));
  const listHost = el('div', {});
  const save = el('button.primary', { onclick: doSave }, 'Save');
  let boxes = [];

  // Ingredients are stock the shop crafts with and never sells, so they are not
  // offered: a special made of them could not be rung up anyway.
  const sellable = (items || []).filter((it) => !it.ingredient);

  function paint() {
    const tag = pick.value;
    boxes = [];
    if (!sellable.length) {
      mount(listHost, el('p', { class: 'note' }, 'Nothing to tag yet — stock the shop first.'));
      return;
    }
    mount(listHost, el('div', { class: 'tag-picker' }, sellable.map((it) => {
      const box = el('input', { type: 'checkbox' });
      box.checked = (it.tags || []).includes(tag);
      boxes.push({ box, item: it.item });
      return el('label', { class: 'tag-check' }, [box, el('span', {}, it.item)]);
    })));
  }
  pick.addEventListener('change', () => { setStatus(''); paint(); });
  paint();

  let modal;
  async function doSave() {
    save.disabled = true;
    setStatus('Saving…');
    try {
      await api.setItemTag(pick.value, boxes.filter((b) => b.box.checked).map((b) => b.item));
      onSaved();
      modal.close();
      toast('Kinds saved.', 'ok');
    } catch (e) {
      save.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  modal = openModal([
    el('h3', {}, 'Kinds of item'),
    el('p', { class: 'note' }, 'What each thing IS — food, drink, a weapon. Specials can then ask for five ' +
      'food and five drink rather than naming the items, and the customer chooses at the till.'),
    el('label', {}, 'Kind'), pick,
    el('p', { class: 'note' }, 'Tick everything that is this kind. Unticking takes the kind off — nothing ' +
      'else about the item changes, and its other kinds stay as they are.'),
    listHost,
    el('div', { class: 'row-actions' }, [save]),
    status,
  ]);
}

/** Focus modal to edit an existing item's sale price + low-stock threshold. */
function openItemModal(it, onSaved) {
  const price = el('input', { type: 'number', step: '0.01', min: '0', value: String(it.price) });
  const low = el('input', { type: 'number', step: '1', min: '0', value: String(it.lowStock || 0) });
  const ingredient = el('input', { type: 'checkbox' });
  ingredient.checked = !!it.ingredient;
  /**
   * What the shop pays one of its own people, per unit, for bringing this in.
   *
   * Set here rather than on the Harvest side because it is the OWNER's
   * decision, made in advance — the person claiming it is the last one who
   * should be able to say what their haul is worth. Blank or 0 means the shop
   * does not pay for this, and Harvest offers no payment for it.
   */
  const harvestPay = el('input', {
    type: 'number', step: '0.01', min: '0',
    value: it.harvestPay ? String(it.harvestPay) : '',
    placeholder: 'Leave blank if you do not pay for this',
  });
  const priceWrap = el('div', {}, [
    el('label', {}, 'Sale price — the register’s default for this item'), price,
  ]);
  priceWrap.hidden = ingredient.checked;
  ingredient.addEventListener('change', () => { priceWrap.hidden = ingredient.checked; });
  // WHAT KIND OF THING this is. On the listing rather than the shared index,
  // like Ingredient above it: one tavern's drink is a hedge wizard's reagent.
  const kinds = tagChooser(it.tags);
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
        // Blank clears it; the Worker reads an empty string as "no rate".
        harvestPay: harvestPay.value === '' ? 0 : harvestPay.value,
        tags: kinds.value(),
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
    el('label', {}, 'Employee harvest value — paid per item'), harvestPay,
    el('p', { class: 'note' }, 'What you will pay one of your own people for each one they bring in. ' +
      'They claim it on the register’s Harvest side, and it comes out of your coffer as a business ' +
      'expense when they do. Leave it blank if you do not buy this from your staff.'),
    el('label', {}, 'What kind of thing is it?'), kinds.node,
    el('p', { class: 'note' }, 'Used by specials that ask for a kind — “five food and five drink” — rather ' +
      'than naming the items. Tagging a whole shelf at once is quicker under Kinds on the Inventory page.'),
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
 * STOCKTAKE — the counts as text, out and back in again.
 *
 * `Name, Amount`, and deliberately nothing else. A bulk import over this list
 * existed once and was shelved (see `archive/inventory-import/`) because it
 * carried prices too, so one bad paste could rewrite everything the shop
 * charged. Counting stock and pricing stock are different jobs; this does the
 * first, and the Worker will not let a line here do the second whatever it says.
 *
 * The paste is CHECKED BEFORE IT IS APPLIED, and the check is the same call
 * with `apply` left off — so what the preview promises is what the apply does,
 * rather than two code paths that can drift apart.
 */
export function openStocktakeModal(onSaved, prefill) {
  // Both boxes are kept SHORT. They are scrollable and resizable, and every row
  // of height here pushed the buttons further down a modal that was already
  // taller than the window.
  const text = el('textarea', { rows: '7', placeholder: 'Iron Sword, 12\nHealth Potion, 40' });
  if (prefill) text.value = prefill;

  /**
   * A SPREADSHEET INSTEAD OF TYPING. It fills the box below — it does not take
   * a second route into the inventory. Whatever the file says goes through the
   * same check and the same Apply as anything pasted by hand, which is the only
   * reason it is safe to accept a file at all.
   */
  const fileNote = el('p', { class: 'note' });
  const file = el('input', { type: 'file', accept: '.csv,text/csv' });
  file.addEventListener('change', async () => {
    const picked = file.files && file.files[0];
    if (!picked) return;
    fileNote.className = 'note';
    fileNote.textContent = 'Reading ' + picked.name + '…';
    try {
      const { text: filled, note, count } = rowsToStocktake(await readCsvFile(picked));
      if (!count) { fileNote.className = 'warn'; fileNote.textContent = note || 'Nothing to read in that file.'; return; }
      text.value = filled;
      fileNote.textContent = 'Read ' + count + ' line' + (count === 1 ? '' : 's') + ' from ' + picked.name + '. ' +
        note + ' Check it below, then Check this paste.';
      apply.hidden = true;
      mount(report);
      setStatus('');
    } catch (e) {
      fileNote.className = 'error';
      fileNote.textContent = e.message || String(e);
    } finally {
      // Cleared so picking the SAME file again still fires a change event —
      // which is exactly what somebody does after fixing a row in Excel.
      file.value = '';
    }
  });
  const status = el('p', {});
  const report = el('div', {});
  const check = el('button.secondary-btn', { onclick: () => run(false) }, 'Check this paste');
  const apply = el('button.primary', { onclick: () => run(true) }, 'Apply');
  apply.hidden = true; // nothing to apply until a check says there is
  const setStatus = (m, c) => { status.className = c || ''; status.textContent = m || ''; };

  const copy = el('button.secondary-btn.small', { onclick: async () => {
    try { await navigator.clipboard.writeText(current.value); toast('Copied.', 'ok'); }
    catch (e) { current.select(); toast('Select and copy — the browser would not do it for us.', 'warn'); }
  } }, 'Copy');
  const current = el('textarea', { rows: '5', readonly: 'readonly' });
  api.getStocktake().then((r) => { current.value = r.text || ''; })
    .catch((e) => { current.value = e.message || String(e); });

  let modal;
  async function run(doIt) {
    check.disabled = true; apply.disabled = true;
    setStatus(doIt ? 'Applying…' : 'Checking…', '');
    try {
      const r = await api.importStocktake(text.value, doIt);
      draw(r, doIt);
      if (doIt) {
        const done = [
          r.applied ? 'Set ' + r.applied + ' count' + (r.applied === 1 ? '' : 's') : '',
          r.added ? 'added ' + r.added + ' listing' + (r.added === 1 ? '' : 's') : '',
        ].filter(Boolean).join(', ');
        toast(done ? done + '.' : 'Nothing to change.', 'ok');
        onSaved();
        // The list underneath has moved on, so the "current" box must too or it
        // is showing counts that are no longer true.
        api.getStocktake().then((rr) => { current.value = rr.text || ''; }).catch(() => {});
        text.value = '';
        apply.hidden = true;
      }
    } catch (e) {
      setStatus(e.message || String(e), 'error');
      mount(report);
    } finally {
      check.disabled = false; apply.disabled = false;
    }
  }

  function draw(r, applied) {
    const nodes = [];
    const line = (label, cls) => el('p', { class: cls || 'note' }, label);
    if (r.changes.length) {
      nodes.push(el('h4', {}, applied ? 'Changed' : 'Would change'));
      nodes.push(el('div', { class: 'table-scroll' }, tableEl(
        ['Item', 'From', 'To', ''],
        r.changes.map((c) => [c.item, String(c.was), String(c.now),
          (c.delta > 0 ? '+' : '') + c.delta]))));
    } else if (!r.creates.length) {
      nodes.push(line('Nothing to change — every count in the paste already matches.'));
    }
    if (r.unchanged.length) nodes.push(line(r.unchanged.length + ' already correct.'));
    if (r.untouched) {
      nodes.push(line(r.untouched + ' item' + (r.untouched === 1 ? '' : 's') +
        ' in your inventory ' + (r.untouched === 1 ? 'was' : 'were') + ' not in the paste, and ' +
        (r.untouched === 1 ? 'was' : 'were') + ' left exactly as ' + (r.untouched === 1 ? 'it is' : 'they are') + '.'));
    }
    if (r.creates.length) {
      nodes.push(el('h4', {}, applied ? 'Added' : 'Would add'));
      nodes.push(el('div', { class: 'table-scroll' }, tableEl(
        ['Item', 'Amount', 'Price'],
        r.creates.map((c) => [c.item, String(c.stock),
          c.price ? money(c.price) : 'not priced']))));
      // The price is the one thing a stocktake cannot know, so say where it
      // came from and what to do when there was none to take.
      const unpriced = r.creates.filter((c) => !c.known).length;
      nodes.push(line('New listings take their price from the item index. ' +
        (unpriced
          ? unpriced + ' of these ' + (unpriced === 1 ? 'is' : 'are') + ' not in the index, so ' +
            (unpriced === 1 ? 'it comes' : 'they come') + ' in unpriced and flagged for an admin to check — ' +
            'set a price with Edit before selling ' + (unpriced === 1 ? 'it' : 'them') + '.'
          : 'All of these are already in the index.')));
    }
    if (r.invalid.length) {
      nodes.push(el('h4', {}, 'Could not read'));
      nodes.push(el('div', {}, r.invalid.map((i) =>
        el('p', { class: 'note' }, '“' + i.line + '” — ' + i.why))));
    }
    mount(report, ...nodes);
    apply.hidden = applied || !(r.changes.length || r.creates.length);
    setStatus('');
  }

  modal = openModal([
    el('h3', {}, '📋 Stocktake'),
    el('p', { class: 'note' }, 'Your counts as plain text — one item per line, ' +
      'as “Name, Amount”. Copy it out, count the back room, paste it back.'),
    el('label', {}, 'What you hold now'),
    current,
    el('div', { class: 'row-actions' }, [copy]),
    el('label', {}, 'Read it from a CSV'),
    file,
    el('p', { class: 'note' }, 'A .csv with an item column and an amount column — headings like “Item” ' +
      'and “Amount” are found wherever they sit. Any spreadsheet program will save one: choose ' +
      '“Save as” and pick CSV. It fills the box below for you to check.'),
    fileNote,
    el('label', {}, 'Or paste your counts here'),
    text,
    el('p', { class: 'note' }, 'This sets COUNTS. It never changes the price of something you already ' +
      'list, and anything you leave out is left exactly as it is — so a count of one shelf is safe to ' +
      'paste on its own. Anything you list that your shop does not stock yet is ADDED, priced from the ' +
      'item index.'),
    report,
    status,
    // Last in the DOM and pinned to the floor of the modal, so the next thing
    // to press is on screen however long the report underneath the paste box
    // grows.
    el('div', { class: 'modal-actions' }, [check, apply]),
  ], { wide: true });
}
