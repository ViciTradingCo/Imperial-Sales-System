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
import { money } from '../lib/format.js';
import { tileGrid, sectionTiles } from '../lib/tiles.js';
import { renderShopReport } from './shop-report.js';
import { renderShopNotices } from './shop-notices.js';

/** Renders a tile page, with the admin-assigned artwork once it arrives. */
function tilePage(container, { title, note, sections }) {
  const gridHost = el('div', {});
  mount(container, el('div.card', {}, [
    el('h2', {}, title),
    el('p', { class: 'note' }, note),
    gridHost,
  ]));
  const draw = (images) => mount(gridHost, tileGrid(sectionTiles(sections, navigate), images));
  draw({});
  api.getTiles().then((r) => draw(r.images || {})).catch(() => { /* glyphs are fine */ });
}

/** Shop Ledger — the daily three. */
export function renderLedgerSettings(container, { me }) {
  tilePage(container, {
    title: 'Shop Ledger',
    note: (me.business || 'Your shop') + ' — how the shop is doing, day to day. ' +
      'Discounts, style, and the rest are under Shop Settings in the menu.',
    sections: [
      { key: 'led-report', label: 'Performance', hint: 'Revenue & best sellers', glyph: '📈',
        open: (host) => renderShopReport(host) },
      { key: 'led-notices', label: 'Notices', hint: 'Post to your staff', glyph: '📣',
        open: (host) => renderShopNotices(host) },
      { key: 'led-coffer', label: 'Coffers', hint: 'Balance & ledger', glyph: '🪙',
        open: (host) => mount(host, cofferCard()) },
    ],
  });
}

/** Shop Settings — everything an owner configures. */
export function renderShopSettingsPage(container, { me, onBusinessRenamed }) {
  tilePage(container, {
    title: 'Shop Settings',
    note: (me.business || 'Your shop') + ' — how your shop is set up. Day-to-day figures are on the ' +
      'Shop Ledger tile at home; your staff code is on the Employees page, where you invite people.',
    sections: [
      { key: 'led-discounts', label: 'Discounts', hint: 'Reusable offers', glyph: '🏷️',
        open: (host) => mount(host, discountsCard()) },
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
      a.href = url; a.download = type + '-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setStatus('Downloaded ✓', 'ok');
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { btn.disabled = false; }
  }
  const salesBtn = el('button.secondary-btn', { onclick: () => download('sales', salesBtn) }, 'Export sales (CSV)');
  const cofferBtn = el('button.secondary-btn', { onclick: () => download('coffer', cofferBtn) }, 'Export coffer (CSV)');
  return el('div.card', {}, [
    el('h2', {}, 'Export data'),
    el('p', { class: 'note' }, 'Download your shop’s records as a spreadsheet-friendly CSV for your own bookkeeping.'),
    el('div', { class: 'row-actions' }, [salesBtn, cofferBtn]),
    status,
  ]);
}

/* ---- Discounts ---- */
function discountsCard() {
  const list = el('div', {}, el('p', { class: 'note' }, 'Loading…'));
  const name = el('input', { type: 'text', placeholder: 'Discount name' });
  const pct = el('input', { type: 'number', min: '1', max: '100', step: '1', placeholder: '%' });
  const status = el('p', {});
  const add = el('button.primary', { onclick: doAdd }, 'Add');
  function setStatus(msg, cls) { status.className = cls || ''; status.textContent = msg; }

  function render(ds) {
    if (!ds.length) { mount(list, el('p', { class: 'note' }, 'No discounts yet.')); return; }
    mount(list, ...ds.map((d) => el('div.emp-row', {}, [
      el('span', { html: '<b>' + esc(d.name) + '</b> · ' + esc(String(d.percent)) + '%' }),
      el('button.danger.small', { onclick: () => remove(d.id) }, 'Delete'),
    ])));
  }
  function load() { api.getDiscounts().then((r) => render(r.discounts || [])).catch((e) => mount(list, el('p', { class: 'error' }, e.message || String(e)))); }

  async function doAdd() {
    add.disabled = true; setStatus('Saving…', '');
    try { render((await api.addDiscount(name.value.trim(), pct.value)).discounts || []); name.value = ''; pct.value = ''; setStatus('', ''); }
    catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { add.disabled = false; }
  }
  async function remove(id) {
    try { render((await api.deleteDiscount(id)).discounts || []); }
    catch (e) { setStatus(e.message || String(e), 'error'); }
  }

  load();
  return el('div.card', {}, [
    el('h2', {}, 'Discounts'),
    el('p', { class: 'note' }, 'Named discounts your staff can pick at the register.'),
    el('div', { class: 'row-actions' }, [name, pct, add]),
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
