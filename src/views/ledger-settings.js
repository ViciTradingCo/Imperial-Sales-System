/**
 * The owner's two screens for their own shop, sharing the cards below.
 *
 *   • Shop Ledger (Home tile)  — what an owner checks while TRADING:
 *     performance, notices to staff, and the coffer.
 *   • Shop Settings (side menu) — what they SET UP and rarely touch again:
 *     discounts, exports, the staff code, and the shop's
 *     own name and style.
 *
 * They were one screen of ten tiles, which meant the coffer — looked at daily —
 * sat beside the accent colour, looked at once. Splitting by how often a thing
 * is used is what makes the daily screen short.
 *
 * Scoped to the caller's business by the API.
 */
import { el, mount, esc } from '../lib/dom.js';
import { navigate } from '../lib/router.js';
import { api } from '../lib/api.js';
import { renderSettingsForm } from './settings-form.js';
import { money, itemTags, tagLabel } from '../lib/format.js';
import { tileGrid, sectionTiles } from '../lib/tiles.js';
import { renderShopReport } from './shop-report.js';
import { renderShopNotices } from './shop-notices.js';
import { renderSales, renderIntake } from './shop-history.js';
import { canManage } from '../lib/roles.js';
import { backToHome } from '../lib/sections.js';
import { createItemPicker } from '../lib/item-picker.js';
import { openStocktakeModal } from './inventory.js';
import { toast } from '../lib/toast.js';

/** Renders a tile page, with the admin-assigned artwork once it arrives. */
function tilePage(container, { title, note, sections }) {
  const gridHost = el('div', {});
  mount(container, el('div.card', {}, [
    backToHome(),
    el('h2', {}, title),
    el('p', { class: 'note' }, note),
    gridHost,
  ]));
  const draw = (images) => mount(gridHost, tileGrid(sectionTiles(sections, navigate), images));
  draw({});
  api.getTiles().then((r) => draw(r.images || {})).catch(() => { /* glyphs are fine */ });
}

/**
 * Shop Ledger — the shop's own book: what has happened, and how it is going.
 *
 * Past sales and deliveries used to be a separate page called the Sales Log,
 * which meant an owner looking over the day's trade had two pages to visit and
 * nothing in either name to say which held what. They are sections here now.
 *
 * WHICH SECTIONS YOU SEE DEPENDS ON YOUR ROLE, rather than the page being shut
 * to employees. Looking up an order — and voiding one you mis-rang — was always
 * open to anyone who works the till, and folding it into a manager-only page
 * would have quietly taken that away. So the door is open and the tiles differ.
 * Every one of them is enforced in the Worker regardless of what is offered.
 */
export function renderLedgerSettings(container, { me }) {
  const sections = [
    // What has already happened. Everyone who works the till.
    { key: 'log-sales', label: 'Sales', hint: 'Find or void a past order', glyph: '🧾',
      open: (host) => renderSales(host) },
    { key: 'log-intake', label: 'Deliveries', hint: 'Intake you have recorded', glyph: '🚚',
      open: (host) => renderIntake(host, canManage(me)) },
  ];
  // How the shop is DOING, and its money. The owner's and the manager's.
  if (canManage(me)) {
    sections.push(
      { key: 'led-report', label: 'Performance', hint: 'Revenue & best sellers', glyph: '📈',
        open: (host) => renderShopReport(host) },
      { key: 'led-notices', label: 'Notices', hint: 'Post to your staff', glyph: '📣',
        open: (host) => renderShopNotices(host) },
      { key: 'led-coffer', label: 'Coffers', hint: 'Balance & ledger', glyph: '🪙',
        open: (host) => mount(host, cofferCard()) },
    );
  }
  tilePage(container, {
    title: 'Shop Ledger',
    note: (me.business || 'Your shop') + ' — what the shop has done, and how it is doing. ' +
      (canManage(me) ? 'Discounts, style, and the rest are under Shop Settings in the menu.' : ''),
    sections,
  });
}

/** Shop Settings — everything an owner configures. */
export function renderShopSettingsPage(container, { me, onBusinessRenamed }) {
  tilePage(container, {
    title: 'Shop Settings',
    note: (me.business || 'Your shop') + ' — how your shop is set up. Day-to-day figures are on the ' +
      'Shop Ledger tile at home; your staff code is on the Employees page, where you invite people.',
    sections: [
      // ONE tile for the two, because they answer the same question — "what do
      // I charge for this, other than the list price?" — and an owner setting up
      // a Friday deal should not have to know in advance whether the app files
      // it under a percentage or a basket.
      { key: 'led-discounts', label: 'Specials & Discounts', hint: 'Specials, discounts, upcharges', glyph: '🏷️',
        open: (host) => mount(host, bundlesCard(), discountsCard()) },
      { key: 'led-export', label: 'Export', hint: 'Sales & coffer CSV', glyph: '📤',
        open: (host) => mount(host, exportCard()) },
      // Name, look, and tunables are one job — "set my shop up" — and were three
      // tiles you had to visit in turn to do it.
      { key: 'led-settings', label: 'Settings', hint: 'Name & style', glyph: '⚙️',
        open: (host) => {
          const formHost = el('div', {});
          mount(host, companyCard(me, onBusinessRenamed), styleCard(), formHost);
          renderShopSettings(formHost);
        } },
    ],
  });
}

function renderShopSettings(formHost) {
  renderSettingsForm(formHost, {
    title: 'Shop settings',
    subtitle: 'Tunables that apply only to your business.',
    load: async () => (await api.getLedgerSettings()).settings,
    save: async (updates) => (await api.saveLedgerSettings(updates)).settings,
    back: false,
  });
}

function companyCard(me, onBusinessRenamed) {
  const input = el('input', { type: 'text', value: me.business || '', placeholder: 'Company name' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save company name');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  async function doSave() {
    const name = input.value.trim();
    if (!name) { setStatus('Enter a company name.', 'error'); return; }
    save.disabled = true;
    setStatus('Saving…', '');
    try {
      const updated = await api.renameBusiness(name);
      setStatus('Saved ✓', 'ok');
      save.disabled = false;
      if (onBusinessRenamed) onBusinessRenamed(updated);
    } catch (e) {
      save.disabled = false;
      setStatus(e.message || String(e), 'error');
    }
  }

  return el('div.card', {}, [
    el('h2', {}, 'Company'),
    el('label', {}, 'Company name'),
    input,
    el('p', { class: 'note' }, 'Renaming updates it everywhere — your shop, your staff, and the registry.'),
    save,
    status,
  ]);
}

/* ---- Coffers ---- */
function cofferCard() {
  const balance = el('p', { class: 'coffer-balance' }, '…');
  const ledger = el('div', {}, el('p', { class: 'note' }, 'Loading…'));
  const amount = el('input', { type: 'number', step: '0.01', placeholder: 'Amount (negative to withdraw)' });
  const note = el('input', { type: 'text', placeholder: 'Note (optional)' });
  const status = el('p', {});
  const apply = el('button.primary', { onclick: doAdjust }, 'Apply');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  function render(s) {
    balance.textContent = 'Balance: ' + money(s.balance);
    const entries = s.entries || [];
    if (!entries.length) { mount(ledger, el('p', { class: 'note' }, 'No coffer activity yet.')); return; }
    mount(ledger, ...entries.map((e) => el('div.emp-row', {}, [
      el('span', { html: '<b>' + (Number(e.amount) >= 0 ? '+' : '') + esc(money(e.amount)) + '</b> ' +
        '<span class="note">' + esc(e.kind) + (e.note ? ' · ' + esc(e.note) : '') + ' · ' + esc(shortDate(e.ts)) + '</span>' }),
    ])));
  }
  function load() { api.getCoffer().then(render).catch((e) => mount(ledger, el('p', { class: 'error' }, e.message || String(e)))); }

  async function doAdjust() {
    apply.disabled = true; setStatus('Saving…', '');
    try {
      render(await api.adjustCoffer(Number(amount.value), note.value.trim()));
      amount.value = ''; note.value = ''; setStatus('Recorded ✓', 'ok');
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { apply.disabled = false; }
  }

  load();
  return el('div.card', {}, [
    el('h2', {}, 'Coffers'),
    balance,
    el('p', { class: 'note' }, 'Sales add to your coffers; intake and withdrawals subtract. Adjust manually below.'),
    el('div', { class: 'row-actions' }, [amount, note, apply]),
    status,
    ledger,
  ]);
}

/* ---- Data export (owner-facing CSV) ---- */
function exportCard() {
  const status = el('p', {});
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }
  async function download(type, btn) {
    btn.disabled = true; setStatus('Preparing…', '');
    try {
      const blob = await api.exportBusinessCsvBlob(type);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = (type === 'full' ? 'shop-everything' : type) +
        '-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setStatus('Downloaded ✓', 'ok');
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { btn.disabled = false; }
  }
  const fullBtn = el('button.primary', { onclick: () => download('full', fullBtn) }, 'Export everything (CSV)');
  const salesBtn = el('button.secondary-btn', { onclick: () => download('sales', salesBtn) }, 'Sales log only');
  const cofferBtn = el('button.secondary-btn', { onclick: () => download('coffer', cofferBtn) }, 'Coffer only');
  const invBtn = el('button.secondary-btn', { onclick: () => download('inventory', invBtn) }, 'Inventory only');
  return el('div.card', {}, [
    el('h2', {}, 'Export & import data'),
    el('p', { class: 'note' }, 'Download your shop’s records as a spreadsheet-friendly CSV for your own ' +
      'bookkeeping. Everything gives you one file with your sales log, your coffer and your inventory in ' +
      'it, each under its own heading — or take just the one you need.'),
    el('div', { class: 'row-actions' }, [fullBtn, salesBtn, cofferBtn, invBtn]),
    status,
    el('h4', {}, 'Bringing data back in'),
    // The ONE thing that can come back in is stock counts, and it opens the
    // stocktake rather than reimplementing it here: same reader, same check,
    // same Apply. A sales log and a coffer are records of things that HAPPENED
    // — a shop cannot paste those into having happened, and a screen offering
    // to would be offering a lie.
    el('p', { class: 'note' }, 'Stock counts are the part you can bring back. Edit the inventory CSV you ' +
      'exported — or count the shelves into a new one — and read it back in here. It shows you exactly ' +
      'what would change before anything does.'),
    el('p', { class: 'note' }, 'Your sales log and coffer cannot be imported: they are the record of what ' +
      'actually happened, and they are written by the register as it happens.'),
    el('div', { class: 'row-actions' }, [
      el('button.secondary-btn', { onclick: () => openStocktakeModal(() => {}) }, 'Import stock counts'),
    ]),
  ]);
}

/* ---- Discounts & upcharges ---- */
/**
 * Named price adjustments the register can pick.
 *
 * A discount and an upcharge are the same row with the sign flipped, so this is
 * one form with a direction on it rather than two lists to keep in step. The
 * owner picks Off or On and types a plain positive number; the sign is applied
 * on the way to the Worker and never typed.
 */
function discountsCard() {
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

/* ---- Style ---- */
function styleCard() {
  const tagline = el('input', { type: 'text', maxlength: '120', placeholder: 'e.g. Finest steel in the Rift' });
  const accent = el('input', { type: 'color', value: '#7a4a1f' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Save style');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  api.getStyle().then((s) => { tagline.value = s.tagline || ''; if (s.accent) accent.value = s.accent; }).catch(() => {});

  async function doSave() {
    save.disabled = true; setStatus('Saving…', '');
    try { await api.setStyle(tagline.value.trim(), accent.value); setStatus('Saved ✓ — shows on your register.', 'ok'); }
    catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { save.disabled = false; }
  }

  return el('div.card', {}, [
    el('h2', {}, 'Style'),
    el('p', { class: 'note' }, 'A tagline and accent shown on your shop’s register.'),
    el('label', {}, 'Tagline'), tagline,
    el('label', {}, 'Accent colour'), accent,
    save,
    status,
  ]);
}

function shortDate(ts) {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

/** What a special holds, in one line: its items, or the kinds it asks for. */
function bundleContents(b) {
  if (b.needs && b.needs.length) return b.needs.map((n) => n.qty + ' × ' + tagLabel(n.tag)).join(' + ');
  return b.parts.map((p) => p.item + ' ×' + p.qty).join(', ');
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
function bundlesCard() {
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
      el('span', { class: 'emp-who', html: '<b>' + esc(b.name) + '</b> · ' + esc(money(b.price)) +
        ' for ' + b.units + ' item' + (b.units === 1 ? '' : 's') +
        '<br><span class="note">' + esc(bundleContents(b)) + '</span>' }),
      el('span', { class: 'row-actions' }, [
        el('button.secondary-btn.small', { onclick: () => edit(b) }, 'Edit'),
        el('button.danger.small', { onclick: () => remove(b) }, 'Delete'),
      ]),
    ])));
  }

  function edit(b) {
    name.value = b.name;
    price.value = String(b.price);
    rows.splice(0, rows.length);
    needRows.splice(0, needRows.length);
    mode.value = (b.needs && b.needs.length) ? 'kinds' : 'items';
    b.parts.forEach((p) => addRow(p.item, p.qty));
    (b.needs || []).forEach((n) => addNeed(n.tag, n.qty));
    if (!rows.length) addRow();
    drawNeeds();
    paintMode();
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
    });
  }

  async function doSave() {
    const byKind = mode.value === 'kinds';
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
    save.disabled = true; setStatus('Saving…', '');
    try {
      const res = await api.saveBundle(name.value.trim(), price.value, parts, needs);
      render(res.bundles || []);
      name.value = ''; price.value = '';
      rows.splice(0, rows.length); addRow();
      needRows.splice(0, needRows.length); drawNeeds();
      paintMode();
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
    el('label', {}, 'Price for the whole special'), price,
    sumLine,
    el('div', { class: 'row-actions' }, [save]),
    status,
  ]);
}
