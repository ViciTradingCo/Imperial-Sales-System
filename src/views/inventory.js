/**
 * Inventory — WHAT THE SHOP HAS.
 *
 *   • Everyone in the business: view items (price / stock / status), and put
 *     stock in that was PRODUCED rather than bought — Farm/Harvest and Craft.
 *   • Owner/admin: correct a count by hand, edit an item's sale price and
 *     low-stock threshold, move stock to another company, bulk import/export,
 *     and remove a listing.
 *
 * BUYING IS NOT HERE. Recording a delivery and buying ingredients moved to the
 * register's Buying side, because they are till operations — a supplier, a
 * price agreed, coin leaving the coffer — and this page is a list of what you
 * hold. What stayed is what creates stock without spending: a harvest and a
 * craft have no vendor and no cost.
 */
import { money } from '../lib/format.js';
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { skeletonRows } from '../lib/skeleton.js';
import { openModal } from '../lib/modal.js';
import { setOpsActions } from '../lib/sections.js';
import { navigate } from '../lib/router.js';
import { newIdem } from '../lib/id.js';
import { createItemPicker } from '../lib/item-picker.js';
import { emptyState } from '../lib/empty.js';
import { toast } from '../lib/toast.js';

export function renderInventory(container, { me }) {
  const canEdit = me.role === 'owner' || me.role === 'admin';
  setOpsActions(me); // business-tools bar persists across Register/Inventory/Employees
  const listHost = el('div', {}, skeletonRows(4));

  const firstCard = [
    el('h2', {}, 'Inventory'),
    el('p', { class: 'note' }, (me.business || 'Your shop') +
      ' — items, prices, and stock. "Low" means at or below an item’s own Low Stock number. ' +
      'Bought a delivery? That is the register, under Buying.'),
  ];
  // Crafting and harvesting are shop-floor work — the person at the bench or in
  // the field is usually not the owner — so they are open to any active member.
  // Transfers and the bulk import rewrite the listing, and stay with the owner.
  const tools = [
    el('button.secondary-btn', { onclick: () => openHarvestModal(refreshInventory) }, 'Farm/Harvest'),
    el('button.secondary-btn', { onclick: () => openCraftModal(refreshInventory) }, 'Craft'),
  ];
  if (canEdit) {
    // Not a duplicate of the register's Buying tile — it is the signpost for
    // someone who came here looking for Record Intake, where it used to be.
    tools.unshift(el('button.primary', { onclick: () => navigate('/pos/buy') }, 'Buy / Record a delivery'));
    tools.push(
      el('button.secondary-btn', { onclick: () => openTransferModal(me, refreshInventory) }, 'Transfer'),
      el('button.secondary-btn', { onclick: () => openImportExportModal(refreshInventory) }, 'Import/Export'),
    );
  }
  firstCard.push(el('div', { class: 'row-actions' }, tools));
  firstCard.push(listHost);
  const nodes = [el('div.card', {}, firstCard)];

  mount(container, ...nodes);

  function renderList(items) {
    if (!items.length) {
      // No action button here: the toolbar is a few pixels above, and the empty
      // state was rendering a second one right under it.
      mount(listHost, emptyState({ glyph: '📦', title: 'No items yet',
        hint: canEdit
          ? 'Record a delivery on the register’s Buying side to stock your first item — it will appear here '
            + 'with its price and stock.'
          : 'Nothing stocked yet.' }));
      return;
    }
    const rows = items.map((it) => {
      const meta = el('span', { html:
        '<b>' + esc(it.item) + '</b> · ' +
        // An ingredient is never sold, so its sale price says nothing. What you
        // need for one is what it COSTS — the figure you are about to spend the
        // next time you go and buy more.
        (it.ingredient
          ? '<span class="role-pill">Ingredient</span>' +
            (it.avgCost ? ' · bought at ' + money(it.avgCost) : '')
          : money(it.price)) +
        ' · ' + it.stock + ' in stock · ' + statusTag(it.status) });
      const row = el('div.emp-row', {}, [meta]);
      if (canEdit) {
        const edit = el('button.primary.small', { onclick: () => openItemModal(it, refreshInventory) }, 'Edit');
        const count = el('button.secondary-btn.small', { onclick: () => openStockModal(it, refreshInventory) }, 'Stock');
        const del = el('button.secondary-btn.small', {
          onclick: async () => {
            if (!confirm('Remove "' + it.item + '" from your inventory?\n\n' +
              'This deletes the listing and its sale price. An item with no stock left is kept on ' +
              'purpose — it stays priced and ready for the next delivery — so there is no need to ' +
              'remove it just because it hit zero.')) return;
            try { const res = await api.deleteItem(it.item); renderList(res.inventory || []); }
            catch (e) { alert(e.message || e); }
          },
        }, 'Remove');
        row.appendChild(el('span', { class: 'row-actions' }, [edit, count, del]));
      }
      return row;
    });
    mount(listHost, ...rows);
  }

  async function refreshInventory() {
    try { renderList((await api.getInventory()).inventory || []); }
    catch (e) { mount(listHost, el('p', { class: 'error' }, e.message || String(e))); }
  }
  refreshInventory();
}

function statusTag(s) {
  const cls = s === 'Out of Stock' ? 'bad' : s === 'Low' ? 'warn' : 'ok';
  return '<span class="' + cls + '">' + esc(s) + '</span>';
}

/** Focus modal to edit an existing item's sale price + low-stock threshold. */
function openItemModal(it, onSaved) {
  const price = el('input', { type: 'number', step: '0.01', min: '0', value: String(it.price) });
  const low = el('input', { type: 'number', step: '1', min: '0', value: String(it.lowStock || 0) });
  const ingredient = el('input', { type: 'checkbox' });
  ingredient.checked = !!it.ingredient;
  const priceWrap = el('div', {}, [
    el('label', {}, 'Sale price — the register’s default for this item'), price,
  ]);
  priceWrap.hidden = ingredient.checked;
  ingredient.addEventListener('change', () => { priceWrap.hidden = ingredient.checked; });
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
 * FARM / HARVEST — stock you produced rather than bought.
 *
 * Intake asks eight questions because a purchase has eight answers: who sold
 * it, where, what it cost, what you will charge. A harvest has two. There was
 * no vendor, no region of purchase, and above all no COST — nobody was paid, so
 * nothing leaves the coffer.
 *
 * Recording these as an intake at 0 was the only way before, and it lied twice:
 * it invented a purchase from nobody, and a free thing looks to the market like
 * a thing worth nothing, dragging the item's value down in every report.
 */
function openHarvestModal(onDone) {
  const idem = newIdem(); // a retry must not double the crop
  const picker = createItemPicker({
    allowFree: true,
    placeholder: 'What did you bring in?',
    freeHint: 'Not in the index — it will be added for an admin to check.',
    meta: (it) => (it.category && it.category !== 'Unsorted' ? it.category : ''),
  });
  api.getItems().then((r) => picker.setItems(r.items || [])).catch(() => {});
  const qty = el('input', { type: 'number', step: '1', min: '1', value: '1' });
  const ingredient = el('input', { type: 'checkbox' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Add to stock');
  function setStatus(m, c) { status.className = c || ''; status.textContent = m; }

  let modal;
  async function doSave() {
    const picked = picker.selected();
    const item = picked ? picked.name : picker.value();
    if (!item) { setStatus('What did you bring in?', 'error'); return; }
    if (!(Number(qty.value) > 0)) { setStatus('How many? Enter at least 1.', 'error'); return; }
    save.disabled = true;
    setStatus('Adding…', '');
    try {
      await api.harvest({
        item, numItems: qty.value,
        // Only sent when ticked, so a harvest never silently un-flags an
        // ingredient the owner already marked — the same rule intake follows.
        ingredient: ingredient.checked ? true : undefined,
        idempotencyKey: idem,
      });
      onDone();
      modal.close();
      toast(item + ' ×' + qty.value + ' added to stock.', 'ok');
    } catch (e) {
      save.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  modal = openModal([
    el('h3', {}, 'Farm / Harvest'),
    el('p', { class: 'note' }, 'Stock you produced rather than bought — a crop, a hunt, a dig. ' +
      'It goes straight into your inventory. No money changes hands, so nothing leaves your coffer ' +
      'and it does not count as a purchase in the market figures.'),
    el('label', {}, 'Item'), picker.el,
    el('label', {}, 'How many'), qty,
    el('label', { class: 'check-row' }, [ingredient, el('span', {}, 'Ingredient — stock to craft with, not to sell')]),
    save,
    status,
  ]);
}

/**
 * Crafting — turn stock you hold into something else.
 *
 * Ingredients are chosen from what the shop ACTUALLY HAS (with its stock shown),
 * because you cannot craft with what you do not hold; the output is chosen from
 * the master index, because you can make something you have never stocked. Both
 * are pickers rather than free text, for the same reason the register is: a
 * typo here would silently invent an item.
 *
 * Nothing is charged — no gold changed hands, so no coffer entry and no effect
 * on what items are worth.
 */
function openCraftModal(onDone) {
  const idem = newIdem(); // a retry must not eat the ingredients twice
  let stock = [];   // what this shop holds
  let master = [];  // what can be made

  const rowsHost = el('div', {});
  const rows = [];  // [{ el, picker, qty }]

  const outPicker = createItemPicker({
    placeholder: 'What are you making?',
    // The type only, to tell similarly named items apart. No price: this picks
    // a name, and the cost and sale price have their own fields below.
    meta: (it) => (it.category && it.category !== 'Unsorted' ? it.category : ''),
  });
  const outQty = el('input', { type: 'number', step: '1', min: '1', value: '1' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doCraft }, 'Craft');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  Promise.all([
    api.getInventory().catch(() => ({ inventory: [] })),
    api.getItems().catch(() => ({ items: [] })),
  ]).then(([inv, idx]) => {
    // Only items with stock left: offering an ingredient you have none of is
    // offering a craft that cannot succeed.
    stock = (inv.inventory || []).filter((it) => it.stock > 0)
      .map((it) => ({ name: it.item, stock: it.stock }));
    master = idx.items || [];
    outPicker.setItems(master);
    rows.forEach((r) => r.picker.setItems(stock));
    if (!stock.length) setStatus('You have nothing in stock to craft with.', 'warn');
  });

  function addRow() {
    const picker = createItemPicker({
      placeholder: 'Ingredient…',
      meta: (it) => it.stock + ' in stock',
      items: stock,
    });
    const qty = el('input', { type: 'number', step: '1', min: '1', value: '1' });
    const remove = el('button.secondary-btn.small', { onclick: () => {
      const i = rows.findIndex((r) => r.picker === picker);
      if (i >= 0) { rows.splice(i, 1); draw(); }
    } }, 'Remove');
    const node = el('div', { class: 'craft-row' }, [picker.el, qty, remove]);
    rows.push({ node, picker, qty, remove });
    draw();
  }

  function draw() {
    // The last remaining row keeps no Remove button — a craft with no
    // ingredients is not a state worth being able to reach.
    rows.forEach((r) => { r.remove.hidden = rows.length < 2; });
    mount(rowsHost, ...rows.map((r) => r.node));
  }

  async function doCraft() {
    const inputs = [];
    for (const r of rows) {
      const name = r.picker.value();
      if (!name) { setStatus('Pick each ingredient from your stock.', 'error'); return; }
      const q = Math.floor(Number(r.qty.value));
      if (!q || q < 1) { setStatus('Each ingredient needs a quantity.', 'error'); return; }
      inputs.push({ item: name, qty: q });
    }
    const outName = outPicker.value();
    if (!outName) { setStatus('Pick what you are making.', 'error'); return; }
    const oq = Math.floor(Number(outQty.value));
    if (!oq || oq < 1) { setStatus('How many are you making?', 'error'); return; }

    save.disabled = true;
    setStatus('Crafting…', '');
    try {
      const res = await api.convertInventory(inputs, { item: outName, qty: oq }, idem);
      onDone();
      modal.close();
      toast(res.duplicate
        ? 'Already crafted.'
        : 'Made ' + res.made.qty + ' × ' + res.made.item + '.', 'ok');
    } catch (e) {
      save.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  addRow();
  const modal = openModal([
    el('h3', {}, 'Craft'),
    el('p', { class: 'note' }, 'Turn stock you hold into something else. The ingredients are removed and what ' +
      'you make is added. No money changes hands.'),
    el('label', {}, 'Ingredients — item and how many'),
    rowsHost,
    el('button.secondary-btn.small', { onclick: addRow }, '+ Add ingredient'),
    el('label', {}, 'Makes'),
    el('div', { class: 'craft-row' }, [outPicker.el, outQty]),
    save,
    status,
  ]);
}

/** Bulk import/export inventory via a copy-paste text box (focus modal). */
function openImportExportModal(onImported) {
  const exportBox = el('textarea', { rows: '8', readonly: true });
  const importBox = el('textarea', { rows: '8', placeholder: 'Item, price, stock, low\n(one per line — “Item price” also works)' });
  const status = el('p', {});
  const importBtn = el('button.primary', { onclick: doImport }, 'Import');
  function setStatus(m, c) { status.className = c || ''; status.textContent = m; }

  api.getInventory().then((inv) => {
    const rows = (inv.inventory || []).map((it) => [it.item, it.price, it.stock, it.lowStock].join(', '));
    exportBox.value = 'Item, Price, Stock, Low Stock\n' + rows.join('\n');
  }).catch(() => {});

  async function doImport() {
    const rows = parseImport(importBox.value);
    if (!rows.length) { setStatus('Nothing to import.', 'error'); return; }
    importBtn.disabled = true; setStatus('Importing…', '');
    try {
      const res = await api.importInventory(rows);
      setStatus('Imported ' + (res.imported || 0) + ' item(s).', 'ok');
      onImported();
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { importBtn.disabled = false; }
  }

  openModal([
    el('h3', {}, 'Import / Export inventory'),
    el('label', {}, 'Export — copy this'),
    exportBox,
    el('label', {}, 'Import — paste here'),
    el('p', { class: 'note' }, 'One item per line: “Item, price, stock, low”. Stock/low optional; a header line is ignored. Sets prices (and stock if given).'),
    importBox,
    importBtn,
    status,
  ]);
}

/** Parses pasted lines into rows (comma-CSV, or "Name price stock low"). */
function parseImport(text) {
  const out = [];
  String(text || '').split('\n').forEach((line) => {
    line = line.trim();
    if (!line) return;
    let parts;
    if (line.includes(',')) parts = line.split(',').map((s) => s.trim());
    else {
      const toks = line.split(/\s+/);
      const nums = [];
      while (toks.length && /^-?\d+(\.\d+)?$/.test(toks[toks.length - 1])) nums.unshift(toks.pop());
      parts = [toks.join(' '), ...nums];
    }
    const [item, price, stock, lowStock] = parts;
    if (item) out.push({ item, price, stock, lowStock });
  });
  return out;
}

/**
 * Transfer goods to another company. Sending debits your stock immediately; the
 * goods only appear in the receiver's inventory once they accept (from the
 * incoming list here). Shows pending incoming (with Accept) and outgoing.
 */
function openTransferModal(me, onChanged) {
  // Transfers move YOUR stock, so the picker is bound to in-stock inventory
  // (already canonical names) rather than the whole master index.
  const picker = createItemPicker({
    placeholder: 'Search your stock…',
    meta: (it) => it.stock + ' in stock',
  });
  const qty = el('input', { type: 'number', min: '1', step: '1', placeholder: 'Amount' });
  const toSel = el('select', {}, el('option', { value: '' }, 'Receiving company…'));
  const status = el('p', {});
  const send = el('button.primary', { onclick: doSend }, 'Confirm transfer');
  const pendingHost = el('div', {}, el('p', { class: 'note' }, 'Loading transfers…'));
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  // Populate the item picker from current stock, and the company dropdown.
  api.getInventory().then((inv) => {
    picker.setItems((inv.inventory || []).filter((it) => it.stock > 0).map((it) => ({ name: it.item, stock: it.stock })));
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

  let sendKey = null; // stable across a retry of the same send; cleared on success
  async function doSend() {
    const picked = picker.selected();
    if (!picked) { setStatus('Pick an item from your stock.', 'error'); return; }
    if (!toSel.value) { setStatus('Pick a receiving company.', 'error'); return; }
    const n = Math.floor(Number(qty.value));
    if (!n || n < 1) { setStatus('Enter an amount.', 'error'); return; }
    if (!sendKey) sendKey = newIdem();
    send.disabled = true;
    setStatus('Sending…', '');
    try {
      renderPending(await api.createTransfer({ toBusiness: toSel.value, item: picked.name, qty: n, idempotencyKey: sendKey }));
      sendKey = null; // next transfer gets a fresh key
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
    el('label', {}, 'Item'), picker.el,
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
