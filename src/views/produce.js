/**
 * PRODUCING stock — the register's Harvest and Craft sides.
 *
 * These lived on Inventory, on the reasoning that the register was for things
 * that move COIN. That line put the four things a shop does to its stock in two
 * different places: two at the till, two on a list. The register is now where
 * stock CHANGES, whichever direction it goes and whether or not money is
 * involved, and Inventory is what the shop currently holds.
 *
 * What is still true is why these two are not intake: nobody was BOUGHT FROM. A
 * harvest and a craft take no vendor, no region and no cost, so neither counts
 * as a purchase in the market figures — recording them as an intake at 0 lied
 * twice, inventing a purchase from nobody and dragging the item's value toward
 * zero in every report.
 *
 * A harvest MAY still cost the shop money: an owner can set a harvest rate on an
 * item, and one of their own people claiming it takes that out of the coffer as
 * a wage. That is a business expense, not a purchase — the shop paid its staff,
 * it did not buy from a supplier, so the coffer moves and the market figures do
 * not.
 *
 * Open to ANY ACTIVE MEMBER, unlike Buying. This is shop-floor work: the person
 * at the bench or in the field is usually not the owner.
 */
import { el, mount } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
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

  // What the shop pays per unit, by lower-cased item name. Read from the
  // shop's own inventory rather than the master index: a rate is one shop's
  // offer to its own people, not a property of the item.
  const rates = new Map();
  const rateFor = (name) => rates.get(String(name || '').trim().toLowerCase()) || 0;

  const picker = createItemPicker({
    allowFree: true,
    placeholder: 'What did you bring in?',
    freeHint: 'Not in the index — it will be added for an admin to check.',
    // The rate comes FIRST in the meta line, because on the Harvest side "this
    // one is paid for" is the thing worth scanning the list for.
    meta: (it) => {
      const rate = rateFor(it.name);
      const cat = it.category && it.category !== 'Unsorted' ? it.category : '';
      const paid = rate ? 'pays ' + money(rate) + ' each' : '';
      return [paid, cat].filter(Boolean).join(' · ');
    },
    onPick: () => paintPay(),
  });
  api.getItems().then((r) => picker.setItems(r.items || [])).catch(() => {});
  // Clicking a suggestion fires onPick; typing a name out does not, and this
  // side takes free text. The input event bubbles, so one listener on the
  // wrapper covers both without the picker needing a second callback.
  picker.el.addEventListener('input', () => paintPay());

  function loadRates() {
    return api.getInventory().then((r) => {
      rates.clear();
      (r.inventory || []).forEach((i) => {
        if (i.harvestPay > 0) rates.set(String(i.item).toLowerCase(), Number(i.harvestPay));
      });
    }).catch(() => {});
  }
  loadRates().then(paintPay);

  const qty = el('input', { type: 'number', step: '1', min: '1', value: '1', 'aria-label': 'How many you brought in' });
  const ingredient = el('input', { type: 'checkbox' });
  const claim = el('input', { type: 'checkbox', checked: true });
  const claimRow = el('label', { class: 'check-row' }, [claim, el('span', {}, 'Claim the harvest payment')]);
  const owedLine = el('div', { class: 'buy-total' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Add to stock');
  const setStatus = (m, c) => { status.className = c || ''; status.textContent = m || ''; };

  const pickedName = () => {
    const picked = picker.selected();
    return picked ? picked.name : picker.value();
  };

  /**
   * The whole point of the feature: say what you are owed BEFORE you commit,
   * so the figure is not a surprise in the coffer afterwards.
   *
   * When the item carries no rate the row is hidden entirely rather than shown
   * as zero — an unpaid harvest is the ordinary case, and "you are owed 0" is
   * an answer to a question nobody asked.
   */
  function paintPay() {
    const rate = rateFor(pickedName());
    claimRow.hidden = !rate;
    owedLine.hidden = !rate || !claim.checked;
    if (owedLine.hidden) { owedLine.textContent = ''; return; }
    const n = Math.floor(Number(qty.value)) || 0;
    owedLine.textContent = n > 0
      ? 'You are owed ' + money(n * rate) + ' for ' + n + ' × ' + pickedName()
      : 'This pays ' + money(rate) + ' each.';
  }
  qty.addEventListener('input', paintPay);
  claim.addEventListener('change', paintPay);

  async function doSave() {
    const item = pickedName();
    if (!item) { setStatus('What did you bring in?', 'error'); return; }
    if (!(Number(qty.value) > 0)) { setStatus('How many? Enter at least 1.', 'error'); return; }
    save.disabled = true;
    setStatus('Adding…', '');
    try {
      const res = await api.harvest({
        item, numItems: qty.value,
        // Only sent when ticked, so a harvest never silently un-flags an
        // ingredient the owner already marked — the same rule intake follows.
        ingredient: ingredient.checked ? true : undefined,
        // Asked for only when there is something to ask for. The Worker re-reads
        // the rate from the item and refuses a claim on one that has none, so
        // this flag can never invent a wage.
        claimPay: rateFor(item) > 0 && claim.checked ? true : undefined,
        idempotencyKey: idem,
      });
      markGuideSeen('harvest');
      toast(item + ' ×' + qty.value + ' added to stock.' +
        (res && res.paid ? ' You are owed ' + money(res.paid) + '.' : ''), 'ok');
      // A fresh key with the form: it stays on screen now, so a second crop
      // typed into it would otherwise look like a retry of the first and be
      // silently discarded.
      idem = newIdem();
      picker.clear();
      qty.value = '1';
      ingredient.checked = false;
      claim.checked = true;
      setStatus('');
      // An owner may have changed a rate while this page was open, and the
      // reply just told us what the current one is — re-read rather than trust
      // the copy this form loaded with.
      loadRates().then(paintPay);
      paintPay();
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
      'It goes straight into your inventory, and it does not count as a purchase in the market figures — ' +
        'nobody sold it to you.',
      'That is the difference from Buying: intake asks who sold it to you and what it cost, because there ' +
        'was a supplier. Here there was not.',
      'Some items your shop PAYS for. If the owner has set a harvest value on what you bring in, the ' +
        'search says so, the total says what you are owed, and recording it takes that out of the shop ' +
        'coffer as a business expense there and then. The rate is the owner’s, set on the item in ' +
        'Inventory — you cannot name your own price, and you do not have to haggle for it either.',
      'Tick Ingredient for something you will craft with rather than sell. Leave it alone to keep ' +
        'whatever the item is already marked as — a harvest never un-marks one.',
    ], guideUnseen('harvest')),
    el('label', {}, 'Item'), picker.el,
    el('label', {}, 'How many'), qty,
    el('label', { class: 'check-row' }, [ingredient, el('span', {}, 'Ingredient — stock to craft with, not to sell')]),
    claimRow,
    owedLine,
    el('div', { class: 'row-actions' }, [save]),
    status,
  ]));
  paintPay();
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
