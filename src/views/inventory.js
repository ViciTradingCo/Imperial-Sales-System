/**
 * Inventory page.
 *   • Everyone in the business: view items (price / stock / status).
 *   • Owner/admin: record intake (a purchase transaction — vendor, hold,
 *     quantity, $ per item — which logs the buy and adds stock), edit an item's
 *     sale price + low-stock threshold (via a focus modal opened from Edit), and
 *     remove items. Recent intake is listed for reference.
 * New items are created by recording intake; the edit modal only adjusts an
 * existing item's details.
 */
import { money, regionLabel, regionWord, regionsOn } from '../lib/format.js';
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { skeletonRows } from '../lib/skeleton.js';
import { openModal } from '../lib/modal.js';
import { openStepModal } from '../lib/steps.js';
import { setOpsActions } from '../lib/sections.js';
import { newIdem } from '../lib/id.js';
import { createItemPicker } from '../lib/item-picker.js';
import { emptyState } from '../lib/empty.js';
import { toast } from '../lib/toast.js';

export function renderInventory(container, { me }) {
  const canEdit = me.role === 'owner' || me.role === 'admin';
  setOpsActions(me); // business-tools bar persists across Register/Inventory/Employees
  const listHost = el('div', {}, skeletonRows(4));

  // The Record Intake button sits between the intro and the item list.
  const firstCard = [
    el('h2', {}, 'Inventory'),
    el('p', { class: 'note' }, esc(me.business || 'Your shop') +
      ' — items, prices, and stock. "Low" means at or below an item’s own Low Stock number.'),
  ];
  if (canEdit) {
    firstCard.push(el('div', { class: 'row-actions' }, [
      el('button.primary', { onclick: () => openIntakeModal(refreshAll, me) }, 'Record Intake'),
      el('button.secondary-btn', { onclick: () => openCraftModal(refreshAll) }, 'Craft'),
      el('button.secondary-btn', { onclick: () => openTransferModal(me, refreshAll) }, 'Transfer'),
      el('button.secondary-btn', { onclick: () => openImportExportModal(refreshInventory) }, 'Import/Export'),
    ]));
  }
  firstCard.push(listHost);
  const nodes = [el('div.card', {}, firstCard)];

  mount(container, ...nodes);

  function renderList(items) {
    if (!items.length) {
      // No action button here: Record Intake is in the toolbar a few pixels
      // above, and the empty state was rendering a second one right under it.
      mount(listHost, emptyState({ glyph: '📦', title: 'No items yet',
        hint: canEdit
          ? 'Record an intake above to stock your first item — it will appear here with its price and stock.'
          : 'Nothing stocked yet.' }));
      return;
    }
    const rows = items.map((it) => {
      const meta = el('span', { html:
        '<b>' + esc(it.item) + '</b> · ' +
        // An ingredient has no sale price worth showing — it is never sold.
        (it.ingredient ? '<span class="role-pill">Ingredient</span>' : money(it.price)) +
        ' · ' + it.stock + ' in stock · ' + statusTag(it.status) });
      const row = el('div.emp-row', {}, [meta]);
      if (canEdit) {
        const edit = el('button.primary.small', { onclick: () => openItemModal(it, refreshInventory) }, 'Edit');
        const count = el('button.secondary-btn.small', { onclick: () => openStockModal(it, refreshAll) }, 'Stock');
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
  // Recording intake changes stock, so the list redraws; the delivery itself is
  // listed on the Sales Log, which is where records live now.
  async function refreshAll() { await refreshInventory(); }

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

/**
 * Intake (restock), asked one step at a time.
 *
 * The form grew to nine fields — item, quantity, cost, sale price, ingredient,
 * vendor, supplier, region — which is a wall to scroll for what is usually a
 * four-field job. It is now three steps: WHAT arrived, WHAT IT COST and what it
 * sells for, and WHERE it came from. The last step shows the whole delivery
 * back before anything is recorded.
 */
function openIntakeModal(onRecorded, me) {
  const idem = newIdem(); // one key per intake entry — retries won't double the stock
  // Items must be chosen from the master index so stock never lands under a typo.
  const picker = createItemPicker({
    placeholder: 'Search the item index…',
    // The type only, to tell similarly named items apart. No price: this picks
    // a name, and the cost and sale price have their own fields below.
    meta: (it) => (it.category && it.category !== 'Unsorted' ? it.category : ''),
    onPick: (it) => {
      if (!per.value) per.value = String(it.baseValue);
      // Suggest the index's base value to charge, not the cost — a shop that
      // sells at what it paid makes nothing, and that was the old default.
      if (!sale.value) sale.value = String(it.baseValue);
      showKnownPrice(it.name);
    },
  });
  api.getItems().then((r) => picker.setItems(r.items || [])).catch(() => {});
  const hold = el('select', {}, el('option', { value: '' }, 'Select a ' + regionWord() + '…'));
  /**
   * WHO SOLD IT TO YOU — one field for both kinds of supplier.
   *
   * It used to be two: a free-text "Vendor" and a dropdown asking, separately,
   * whether that vendor happened to be a registered company. That made the
   * common case (an NPC smith) look like it was missing an answer, and the
   * useful case (a real shop) something you had to fill in twice.
   *
   * Now you type a name. Registered companies narrow as you type and can be
   * clicked; anything else is taken as written. Naming a registered company
   * credits it for the supply in its region's figures, and fills in the region
   * from that company's own record — the goods came from where the seller
   * trades, and asking a second time invites a different answer.
   */
  const vendor = createItemPicker({
    allowFree: true,
    placeholder: 'Who did you buy from?',
    freeHint: 'Not a registered company — it will be recorded as typed.',
    meta: (c) => (regionsOn() && c.hold ? c.hold : ''),
    onPick: (c) => {
      // The supplier's own region, unless the user has already chosen one.
      if (regionsOn() && c.hold && !hold.value) hold.value = c.hold;
    },
  });
  api.getBusinesses()
    .then((r) => {
      // `cards` carries each company's region; the plain name list is the
      // fallback for a Worker that has not caught up with this deploy yet.
      const cards = r.cards || (r.businesses || []).map((b) => ({ business: b, hold: '' }));
      vendor.setItems(cards
        .filter((c) => c.business !== (me && me.business))   // a shop does not buy from itself
        .map((c) => ({ name: c.business, hold: c.hold })));
    })
    .catch(() => { /* free text still works; there is just nothing to suggest */ });
  /** The typed name, only when it IS a registered company. */
  const vendorCompany = () => (vendor.selected() ? vendor.selected().name : '');
  const qty = el('input', { type: 'number', step: '1', min: '1', placeholder: '# of items' });
  const per = el('input', { type: 'number', step: '0.01', min: '0', placeholder: 'Cost per item' });
  /**
   * What the register will charge for this item. Separate from the cost above,
   * which is what the shop PAID — conflating the two is how an item ends up
   * listed at its own purchase price.
   */
  const sale = el('input', { type: 'number', step: '0.01', min: '0', placeholder: 'Leave blank to keep the current price' });
  const saleHint = el('p', { class: 'note' }, '');
  /**
   * Stock the shop holds to CRAFT with, not to sell. Ticking it takes the item
   * out of the register and off the public storefront, and the sale price stops
   * meaning anything — so the field goes with it rather than sitting there
   * inviting a number nobody will ever charge.
   */
  const ingredient = el('input', { type: 'checkbox' });
  const saleWrap = el('div', {}, [
    el('label', {}, 'Sale price — what the register will charge'), sale, saleHint,
  ]);
  ingredient.addEventListener('change', () => { saleWrap.hidden = ingredient.checked; });

  // If the shop already lists this item, say what it currently charges, so a
  // blank field is an informed choice rather than a guess.
  let current = [];
  api.getInventory().then((r) => { current = r.inventory || []; }).catch(() => {});
  function showKnownPrice(name) {
    const have = current.find((i) => i.item.toLowerCase() === String(name).toLowerCase());
    saleHint.textContent = have
      ? 'You currently sell this at ' + money(have.price) + '. Leave blank to keep that.'
      : 'New to your shop — this becomes its price in the register.';
  }
  // Fill the hold dropdown.
  api.getRegions()
    .then((res) => (res.holds || []).forEach((h) => hold.appendChild(el('option', { value: h }, h))))
    .catch(() => { /* hold is optional */ });

  // The delivery read back before it is recorded — the one screen where a
  // mistyped quantity or a cost in the sale-price field is obvious.
  const review = el('div', { class: 'step-review' }, '');
  function fillReview() {
    const picked = picker.selected();
    const n = Number(qty.value) || 0;
    const cost = Number(per.value) || 0;
    const rows = [
      ['Item', picked ? picked.name : '—'],
      ['Quantity', String(n)],
      ['Cost', money(cost) + ' each · ' + money(n * cost) + ' total'],
    ];
    if (ingredient.checked) rows.push(['Sells for', 'Ingredient — not sold']);
    else if (sale.value !== '') rows.push(['Sells for', money(Number(sale.value) || 0)]);
    const source = vendor.value();
    // Say which kind it was: a registered company is credited for the supply,
    // a typed name is not, and that difference is worth seeing before it lands.
    if (source) rows.push(['Bought from', source + (vendorCompany() ? ' (registered)' : '')]);
    if (regionsOn() && hold.value) rows.push([regionLabel(), hold.value]);
    review.innerHTML = rows
      .map(([k, v]) => '<div class="step-review-row"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>')
      .join('');
  }

  async function doRecord() {
    await api.recordIntake({
      item: picker.selected().name,
      salePrice: ingredient.checked ? '' : sale.value,
      ingredient: ingredient.checked,
      vendor: vendor.value(),
      fromBusiness: vendorCompany(),
      hold: hold.value,
      numItems: qty.value,
      pricePer: per.value,
      idempotencyKey: idem,
    });
    onRecorded();
  }

  return openStepModal({
    title: 'Record intake (restock)',
    finishLabel: 'Record intake',
    onFinish: doRecord,
    steps: [
      {
        title: 'What arrived?',
        hint: 'Pick the item from the index so the stock never lands under a typo.',
        nodes: [
          el('label', {}, 'Item'), picker.el,
          el('label', {}, '# of items'), qty,
        ],
        validate: () => {
          if (!picker.selected()) return 'Pick an item from the index — start typing and click a result.';
          if (!(Number(qty.value) > 0)) return 'How many arrived? Enter at least 1.';
          return null;
        },
      },
      {
        title: 'What did it cost?',
        hint: 'The cost is what you paid. The sale price is what the register will charge — they are not the same number.',
        nodes: [
          el('label', {}, 'Cost per item — what you paid'), per,
          el('label', { class: 'check-row' }, [ingredient, el('span', {}, 'Ingredient — stock to craft with, not to sell')]),
          saleWrap,
        ],
        validate: () => (per.value !== '' && Number(per.value) >= 0
          ? null
          : 'Enter what you paid per item — 0 is fine if it was free.'),
      },
      {
        title: 'Where did it come from?',
        hint: 'All optional. Fill in what you know.',
        nodes: [
          el('label', {}, 'Vendor'), vendor.el,
          el('p', { class: 'note' }, 'Start typing — shops on this network will appear as you go. Naming one ' +
            'credits it for the supply in its ' + regionWord() + '’s figures. Anyone else, just type the name.'),
          ...(regionsOn() ? [el('label', {}, regionLabel() + ' purchased in'), hold] : []),
          review,
        ],
        onEnter: fillReview,
      },
    ],
  });
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
