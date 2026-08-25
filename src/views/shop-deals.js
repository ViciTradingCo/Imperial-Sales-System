/**
 * WHAT A SHOP CHARGES OTHER THAN THE LIST PRICE.
 *
 * The two cards behind Shop Settings → Specials & Discounts, lifted out of
 * `ledger-settings.js` because they are exactly the seam that module did not
 * have: a group of functions that talk only to each other and to the API, and
 * that nothing else on that page needs.
 *
 * They sit together because that is ONE question to an owner — "what do I
 * charge for this, other than the list price?" — even though the app has to
 * hold the two answers differently: a discount is a signed percentage applied
 * to a whole order, and a special is a named set of goods with a price of its
 * own. An owner setting up a Friday deal should not have to know in advance
 * which of the two the app is going to file it under.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { money, itemTags, tagLabel } from '../lib/format.js';
import { createItemPicker } from '../lib/item-picker.js';
import { toast } from '../lib/toast.js';

/* ---- Discounts & upcharges ---- */
/**
 * Named price adjustments the register can pick.
 *
 * A discount and an upcharge are the same row with the sign flipped, so this is
 * one form with a direction on it rather than two lists to keep in step. The
 * owner picks Off or On and types a plain positive number; the sign is applied
 * on the way to the Worker and never typed.
 */
export function discountsCard() {
  const list = el('div', {}, el('p', { class: 'note' }, 'Loading…'));
  const name = el('input', { type: 'text', placeholder: 'Name' });
  const dir = el('select', {}, [
    el('option', { value: 'off' }, 'Take off'),
    el('option', { value: 'on' }, 'Add on'),
  ]);
  const pct = el('input', { type: 'number', min: '1', max: '1000', step: '1', placeholder: '%' });
  const status = el('p', {});
  const add = el('button.primary', { onclick: doAdd }, 'Add');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  function render(ds) {
    if (!ds.length) { mount(list, el('p', { class: 'note' }, 'Nothing set up yet.')); return; }
    mount(list, ...ds.map((d) => el('div.emp-row', {}, [
      el('span', { class: 'emp-who', html: '<b>' + esc(d.name) + '</b> · ' +
        // The sign is storage; the words are what an owner reads.
        (d.percent < 0
          ? '<span class="warn">+' + esc(String(Math.abs(d.percent))) + '% upcharge</span>'
          : '<span class="ok">−' + esc(String(d.percent)) + '% discount</span>') }),
      el('button.danger.small', { onclick: () => remove(d.id) }, 'Delete'),
    ])));
  }
  function load() { api.getDiscounts().then((r) => render(r.discounts || [])).catch((e) => mount(list, el('p', { class: 'error' }, e.message || String(e)))); }

  async function doAdd() {
    const n = Math.abs(Number(pct.value));
    if (!n) { setStatus('Enter a percentage.', 'error'); return; }
    add.disabled = true; setStatus('Saving…', '');
    try {
      const signed = dir.value === 'on' ? -n : n;
      render((await api.addDiscount(name.value.trim(), signed)).discounts || []);
      name.value = ''; pct.value = ''; setStatus('', '');
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { add.disabled = false; }
  }
  async function remove(id) {
    try { render((await api.deleteDiscount(id)).discounts || []); }
    catch (e) { setStatus(e.message || String(e), 'error'); }
  }

  load();
  return el('div.card', {}, [
    el('h2', {}, 'Discounts & upcharges'),
    el('p', { class: 'note' }, 'Named price adjustments your staff can pick at the register. ' +
      '“Take off” is a discount; “Add on” is an upcharge — a rush job, a rare commission, ' +
      'a customer in bad standing.'),
    el('div', { class: 'row-actions' }, [name, dir, pct, add]),
    status,
    list,
  ]);
}

/** What a special holds, in one line: its items, or the kinds it asks for. */
function bundleContents(b) {
  if (b.needs && b.needs.length) return b.needs.map((n) => n.qty + ' × ' + tagLabel(n.tag)).join(' + ');
  return b.parts.map((p) => p.item + ' ×' + p.qty).join(', ');
}

/**
 * What a special COSTS, in one line.
 *
 * A percentage one has no fixed figure to show: it is worked out at the till
 * from what the shop charges that day, which is the point of pricing a set that
 * way — reprice the armour and the deal follows.
 */
function bundlePrice(b) {
  return b.percentOff ? b.percentOff + '% off its items' : money(b.price);
}

/* ---- Specials: several items, one price ---- */
/**
 * A BUNDLE — "five ales and five stews, sixty gold".
 *
 * The two halves of this screen are the two ways a shop charges something other
 * than the list price: a PERCENTAGE off (or on) the whole order, and a FIXED
 * PRICE for a named set of goods. They sit together because that is one question
 * to an owner, even though the app has to hold them differently.
 *
 * What it costs SEPARATELY is worked out here rather than stored, and shown
 * beside the bundle price so the saving is visible while you set it — a deal
 * whose parts have quietly become cheaper than the bundle is worth noticing.
 */
export function bundlesCard() {
  const list = el('div', {}, el('p', { class: 'note' }, 'Loading…'));
  const name = el('input', { type: 'text', placeholder: 'e.g. Tavern Feast' });
  const price = el('input', { type: 'number', min: '0', step: '1', placeholder: 'Price for the lot' });
  const rowsHost = el('div', {});
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save special');
  const setStatus = (m, c) => { status.className = c || ''; status.textContent = m || ''; };

  let stock = [];          // what this shop actually sells
  const rows = [];         // [{ node, picker, qty }]

  /**
   * THE TWO KINDS OF SPECIAL, and the one choice that separates them.
   *
   * A special either NAMES its items — five ales and five stews — or asks for
   * KINDS of item: five food and five drink, whichever the customer picks.
   * Named is a fixed deal the shop assembles; by kind is a deal the customer
   * assembles at the till out of anything tagged for it.
   *
   * One or the other, never both. A special that did half of each would have to
   * be reconciled at the register, and there is no honest reading of "five
   * drink, one of which is this ale" that is not simply one of the two.
   */
  const mode = el('select', {}, [
    el('option', { value: 'items' }, 'Names its items'),
    el('option', { value: 'kinds' }, 'Asks for kinds of item'),
  ]);

  /**
   * THE TWO WAYS TO PRICE ONE.
   *
   * A flat figure for the lot, or a PERCENTAGE off what the shop already
   * charges for the things in it — a full suit of armour at 10% off, with the
   * rest of the order untouched. That is what separates it from the discount
   * below: this one reaches only its own items.
   *
   * A percentage has no fixed figure, and is not meant to: reprice a piece and
   * the deal follows it, which is the reason to set one up this way.
   */
  const priceMode = el('select', {}, [
    el('option', { value: 'flat' }, 'A price for the whole special'),
    el('option', { value: 'percent' }, 'A percentage off its items'),
  ]);
  const percent = el('input', { type: 'number', min: '0', max: '100', step: '1', placeholder: '% off, e.g. 10' });
  const flatWrap = el('div', {});
  const pctWrap = el('div', {});
  function paintPriceMode() {
    const byPct = priceMode.value === 'percent';
    flatWrap.hidden = byPct;
    pctWrap.hidden = !byPct;
    paintSum();
  }
  priceMode.addEventListener('change', paintPriceMode);
  percent.addEventListener('input', paintSum);
  const needRows = [];     // [{ node, tag, qty }]
  const needsHost = el('div', {});
  const itemsWrap = el('div', {});
  const kindsWrap = el('div', {});

  function addNeed(tag, qty) {
    const kinds = itemTags();
    const pick = el('select', {}, kinds.map((t) => el('option', { value: t.toLowerCase() }, t)));
    if (tag) pick.value = String(tag).toLowerCase();
    const q = el('input', { type: 'number', min: '1', step: '1', value: String(qty || 1), 'aria-label': 'How many' });
    const remove = el('button.secondary-btn.small', { type: 'button', onclick: () => {
      const i = needRows.findIndex((r) => r.tag === pick);
      if (i >= 0) { needRows.splice(i, 1); drawNeeds(); }
    } }, 'Remove');
    const node = el('div', { class: 'need-row' }, [pick, q, remove]);
    needRows.push({ node, tag: pick, qty: q });
    drawNeeds();
    return pick;
  }
  function drawNeeds() { mount(needsHost, ...needRows.map((r) => r.node)); }

  function paintMode() {
    const byKind = mode.value === 'kinds';
    itemsWrap.hidden = byKind;
    kindsWrap.hidden = !byKind;
    if (byKind && !needRows.length) addNeed();
    if (byKind) sumLine.textContent = '';
    else paintSum();
  }
  mode.addEventListener('change', paintMode);

  function addRow(item, qty) {
    const picker = createItemPicker({
      placeholder: 'Item…',
      meta: (it) => money(it.price) + ' each',
      items: stock,
    });
    if (item) picker.setValue(item);
    const q = el('input', { type: 'number', min: '1', step: '1', value: String(qty || 1), 'aria-label': 'How many' });
    q.addEventListener('input', paintSum);
    const remove = el('button.secondary-btn.small', { type: 'button', onclick: () => {
      const i = rows.findIndex((r) => r.picker === picker);
      if (i >= 0) { rows.splice(i, 1); draw(); paintSum(); }
    } }, 'Remove');
    const node = el('div', { class: 'craft-row' }, [picker.el, q, remove]);
    rows.push({ node, picker, qty: q });
    draw();
    return picker;
  }
  function draw() { mount(rowsHost, ...rows.map((r) => r.node)); }

  const sumLine = el('p', { class: 'note' });
  function paintSum() {
    const byName = new Map(stock.map((s) => [s.name.toLowerCase(), s.price]));
    let sep = 0;
    let known = 0;
    rows.forEach((r) => {
      const p = byName.get(String(r.picker.value() || '').trim().toLowerCase());
      const n = Math.floor(Number(r.qty.value)) || 0;
      if (p !== undefined && n > 0) { sep += p * n; known++; }
    });
    if (priceMode.value === 'percent') {
      const off = Number(percent.value);
      sumLine.textContent = !known || !isFinite(off) || !off
        ? ''
        : 'These come to ' + money(sep) + ', so the special sells them for ' +
          money(sep * (100 - off) / 100) + ' — a saving of ' + money(sep * off / 100) + '.';
      return;
    }
    const asked = Number(price.value);
    if (!known || !isFinite(asked) || !asked) { sumLine.textContent = ''; return; }
    const diff = sep - asked;
    sumLine.textContent = diff > 0
      ? 'Separately these come to ' + money(sep) + ' — the bundle saves a customer ' + money(diff) + '.'
      : diff < 0
        ? 'Separately these come to only ' + money(sep) + ', so the bundle costs ' + money(-diff) + ' MORE than buying them one by one.'
        : 'Separately these come to the same ' + money(sep) + '.';
  }
  price.addEventListener('input', paintSum);
  rowsHost.addEventListener('input', paintSum);

  function render(bs) {
    if (!bs.length) { mount(list, el('p', { class: 'note' }, 'No specials yet.')); return; }
    mount(list, ...bs.map((b) => el('div.emp-row', {}, [
      el('span', { class: 'emp-who', html: '<b>' + esc(b.name) + '</b> · ' + esc(bundlePrice(b)) +
        (b.percentOff ? ' · ' : ' for ') + b.units + ' item' + (b.units === 1 ? '' : 's') +
        '<br><span class="note">' + esc(bundleContents(b)) + '</span>' }),
      el('span', { class: 'row-actions' }, [
        el('button.secondary-btn.small', { onclick: () => edit(b) }, 'Edit'),
        el('button.danger.small', { onclick: () => remove(b) }, 'Delete'),
      ]),
    ])));
  }

  function edit(b) {
    name.value = b.name;
    price.value = b.percentOff ? '' : String(b.price);
    percent.value = b.percentOff ? String(b.percentOff) : '';
    priceMode.value = b.percentOff ? 'percent' : 'flat';
    rows.splice(0, rows.length);
    needRows.splice(0, needRows.length);
    mode.value = (b.needs && b.needs.length) ? 'kinds' : 'items';
    b.parts.forEach((p) => addRow(p.item, p.qty));
    (b.needs || []).forEach((n) => addNeed(n.tag, n.qty));
    if (!rows.length) addRow();
    drawNeeds();
    paintMode();
    paintPriceMode();
    setStatus('Editing “' + b.name + '”. Saving replaces it.', '');
  }

  function load() {
    Promise.all([
      api.getBundles().catch(() => ({ bundles: [] })),
      api.getInventory().catch(() => ({ inventory: [] })),
    ]).then(([bs, inv]) => {
      // Only what the shop SELLS: an ingredient is stock to craft with, and a
      // bundle containing one would be refused at the till.
      stock = (inv.inventory || []).filter((i) => !i.ingredient)
        .map((i) => ({ name: i.item, price: i.price }));
      rows.forEach((r) => r.picker.setItems(stock));
      render(bs.bundles || []);
      if (!rows.length) addRow();
      paintMode();
      paintPriceMode();
    });
  }

  async function doSave() {
    const byKind = mode.value === 'kinds';
    const byPct = priceMode.value === 'percent';
    const off = byPct ? Math.floor(Number(percent.value)) || 0 : 0;
    const parts = [];
    const needs = [];
    if (byKind) {
      for (const r of needRows) {
        if (!r.tag.value) continue;
        needs.push({ tag: r.tag.value, qty: Math.floor(Number(r.qty.value)) || 0 });
      }
    } else {
      for (const r of rows) {
        const item = r.picker.value();
        if (!item) continue;
        parts.push({ item, qty: Math.floor(Number(r.qty.value)) || 0 });
      }
    }
    if (!name.value.trim()) { setStatus('Give the special a name.', 'error'); return; }
    if (byKind && !needs.length) { setStatus('Say what kinds it asks for.', 'error'); return; }
    if (!byKind && !parts.length) { setStatus('Put at least one item in it.', 'error'); return; }
    if (byPct && (off < 1 || off > 100)) { setStatus('Say what percentage comes off, 1 to 100.', 'error'); return; }
    save.disabled = true; setStatus('Saving…', '');
    try {
      const res = await api.saveBundle(name.value.trim(), price.value, parts, needs, off);
      render(res.bundles || []);
      name.value = ''; price.value = ''; percent.value = '';
      rows.splice(0, rows.length); addRow();
      needRows.splice(0, needRows.length); drawNeeds();
      paintMode();
      paintPriceMode();
      setStatus('Saved ✓', 'ok');
      toast('Special saved.', 'ok');
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { save.disabled = false; }
  }

  async function remove(b) {
    if (!window.confirm('Delete the “' + b.name + '” special?\n\nSales already rung up with it are untouched.')) return;
    try { render((await api.deleteBundle(b.id)).bundles || []); }
    catch (e) { setStatus(e.message || String(e), 'error'); }
  }

  mount(itemsWrap,
    el('label', {}, 'What is in it'),
    rowsHost,
    el('div', { class: 'row-actions' }, [
      el('button.secondary-btn.small', { type: 'button', onclick: () => addRow().focus() }, '+ Add item'),
    ]));
  mount(kindsWrap,
    el('label', {}, 'What it asks for'),
    needsHost,
    el('div', { class: 'row-actions' }, [
      el('button.secondary-btn.small', { type: 'button', onclick: () => addNeed() }, '+ Add kind'),
    ]),
    el('p', { class: 'note' }, 'The customer picks which — anything your inventory tags with that kind. ' +
      'Tag your stock under Inventory → Kinds; a kind nobody has tagged cannot fill anything.'));

  mount(flatWrap, el('label', {}, 'Price for the whole special'), price);
  mount(pctWrap,
    el('label', {}, 'Percentage off'), percent,
    el('p', { class: 'note' }, 'Taken off what you charge for the things in this special, and nothing else in ' +
      'the order. Reprice one of them and the deal follows — there is no fixed figure to keep up to date.'));

  load();
  return el('div.card', {}, [
    el('h2', {}, 'Specials'),
    el('p', { class: 'note' }, 'Several items sold together for one price. A special either NAMES what is in ' +
      'it, or asks for KINDS — “five food and five drink” — and lets the customer choose at the till. Either ' +
      'way your staff ring it up as one line, and everything in it still comes out of your stock.'),
    list,
    el('h4', {}, 'Add or edit a special'),
    el('label', {}, 'Name'), name,
    el('label', {}, 'How it is filled'), mode,
    itemsWrap,
    kindsWrap,
    el('label', {}, 'How it is priced'), priceMode,
    flatWrap,
    pctWrap,
    sumLine,
    el('div', { class: 'row-actions' }, [save]),
    status,
  ]);
}
