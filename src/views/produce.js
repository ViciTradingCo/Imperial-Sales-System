/**
 * PRODUCING stock — the register's Harvest and Craft sides.
 *
 * These lived on Inventory, on the reasoning that the register was for things
 * that move COIN. That line put the four things a shop does to its stock in two
 * different places: two at the till, two on a list. The register is now where
 * stock CHANGES, whichever direction it goes and whether or not money is
 * involved, and Inventory is what the shop currently holds.
 *
 * What is still true is why these two are not intake: nobody was paid. A
 * harvest and a craft take no vendor, no region and no cost, so neither touches
 * the coffer and neither counts as a purchase in the market figures — recording
 * them as an intake at 0 lied twice, inventing a purchase from nobody and
 * dragging the item's value toward zero in every report.
 *
 * Open to ANY ACTIVE MEMBER, unlike Buying. This is shop-floor work: the person
 * at the bench or in the field is usually not the owner.
 */
import { el, mount } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { guidePanel, guideUnseen, markGuideSeen } from '../lib/guide.js';
import { newIdem } from '../lib/id.js';
import { createItemPicker } from '../lib/item-picker.js';
import { toast } from '../lib/toast.js';

/**
 * FARM / HARVEST — stock you produced rather than bought.
 *
 * Intake asks eight questions because a purchase has eight answers: who sold
 * it, where, what it cost, what you will charge. A harvest has two.
 */
export function renderHarvest(host) {
  let idem = newIdem(); // a retry must not double the crop

  const picker = createItemPicker({
    allowFree: true,
    placeholder: 'What did you bring in?',
    freeHint: 'Not in the index — it will be added for an admin to check.',
    meta: (it) => (it.category && it.category !== 'Unsorted' ? it.category : ''),
  });
  api.getItems().then((r) => picker.setItems(r.items || [])).catch(() => {});

  const qty = el('input', { type: 'number', step: '1', min: '1', value: '1', 'aria-label': 'How many you brought in' });
  const ingredient = el('input', { type: 'checkbox' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Add to stock');
  const setStatus = (m, c) => { status.className = c || ''; status.textContent = m || ''; };

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
      markGuideSeen('harvest');
      toast(item + ' ×' + qty.value + ' added to stock.', 'ok');
      // A fresh key with the form: it stays on screen now, so a second crop
      // typed into it would otherwise look like a retry of the first and be
      // silently discarded.
      idem = newIdem();
      picker.clear();
      qty.value = '1';
      ingredient.checked = false;
      setStatus('');
    } catch (e) {
      setStatus(e.message || String(e), 'error');
    } finally {
      save.disabled = false;
    }
  }

  mount(host, el('div.card', {}, [
    el('h3', {}, 'Farm / Harvest'),
    el('p', { class: 'note' }, 'Stock you produced rather than bought — a crop, a hunt, a dig.'),
    guidePanel([
      'It goes straight into your inventory. No money changes hands, so nothing leaves your coffer and ' +
        'it does not count as a purchase in the market figures.',
      'That is the difference from Buying: intake asks who sold it to you and what it cost, because ' +
        'someone was paid. Here nobody was.',
      'Tick Ingredient for something you will craft with rather than sell. Leave it alone to keep ' +
        'whatever the item is already marked as — a harvest never un-marks one.',
    ], guideUnseen('harvest')),
    el('label', {}, 'Item'), picker.el,
    el('label', {}, 'How many'), qty,
    el('label', { class: 'check-row' }, [ingredient, el('span', {}, 'Ingredient — stock to craft with, not to sell')]),
    el('div', { class: 'row-actions' }, [save]),
    status,
  ]));
}

/**
 * Crafting — turn stock you hold into something else.
 *
 * Ingredients are chosen from what the shop ACTUALLY HAS (with its stock shown),
 * because you cannot craft with what you do not hold; the output is chosen from
 * the master index, because you can make something you have never stocked. Both
 * are pickers rather than free text, for the same reason the register is: a
 * typo here would silently invent an item.
 */
export function renderCraft(host) {
  let idem = newIdem(); // a retry must not eat the ingredients twice
  let stock = [];   // what this shop holds
  let master = [];  // what can be made

  const rowsHost = el('div', {});
  const rows = [];  // [{ node, picker, qty, remove }]

  const outPicker = createItemPicker({
    placeholder: 'What are you making?',
    meta: (it) => (it.category && it.category !== 'Unsorted' ? it.category : ''),
  });
  const outQty = el('input', { type: 'number', step: '1', min: '1', value: '1', 'aria-label': 'How many you are making' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doCraft }, 'Craft');
  const setStatus = (m, c) => { status.className = c || ''; status.textContent = m || ''; };

  function loadStock() {
    return Promise.all([
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
  }
  loadStock();

  function addRow() {
    const picker = createItemPicker({
      placeholder: 'Ingredient…',
      meta: (it) => it.stock + ' in stock',
      items: stock,
    });
    const qty = el('input', { type: 'number', step: '1', min: '1', value: '1', 'aria-label': 'How many of this ingredient' });
    const remove = el('button.secondary-btn.small', { type: 'button', onclick: () => {
      const i = rows.findIndex((r) => r.picker === picker);
      if (i >= 0) { rows.splice(i, 1); draw(); }
    } }, 'Remove');
    const node = el('div', { class: 'craft-row' }, [picker.el, qty, remove]);
    rows.push({ node, picker, qty, remove });
    draw();
    return picker;
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
      markGuideSeen('craft');
      toast(res.duplicate ? 'Already crafted.' : 'Made ' + res.made.qty + ' × ' + res.made.item + '.', 'ok');
      // Same reason as the harvest: the form stays put, so the next craft needs
      // a key of its own or it reads as a retry of this one.
      idem = newIdem();
      rows.splice(0, rows.length);
      addRow();
      outPicker.clear();
      outQty.value = '1';
      setStatus('');
      // The stock this craft just consumed and produced changes what the next
      // one may use, so the ingredient list is re-read rather than left stale.
      loadStock();
    } catch (e) {
      setStatus(e.message || String(e), 'error');
    } finally {
      save.disabled = false;
    }
  }

  addRow();

  mount(host, el('div.card', {}, [
    el('h3', {}, 'Craft'),
    el('p', { class: 'note' }, 'Turn stock you hold into something else.'),
    guidePanel([
      'The ingredients come out of your stock and what you make goes in, in one step. No money changes ' +
        'hands, so nothing touches your coffer and nothing here affects what items are worth.',
      'Ingredients can only be things you actually hold, and each shows how many you have. What you MAKE ' +
        'comes from the item index instead — you can make something your shop has never stocked.',
      'If a craft would take more of something than you have, it is refused rather than leaving you with ' +
        'a negative count.',
    ], guideUnseen('craft')),
    el('label', {}, 'Ingredients — item and how many'),
    rowsHost,
    el('div', { class: 'row-actions' }, [
      el('button.secondary-btn.small', { type: 'button', onclick: () => addRow().focus() }, '+ Add ingredient'),
    ]),
    el('label', {}, 'Makes'),
    el('div', { class: 'craft-row' }, [outPicker.el, outQty]),
    el('div', { class: 'row-actions' }, [save]),
    status,
  ]));
}
