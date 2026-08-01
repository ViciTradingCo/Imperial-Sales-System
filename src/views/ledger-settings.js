/**
 * Shop Ledger (owner) — the owner's control room for one shop:
 *   • Company name
 *   • Coffers — treasury balance, ledger, and manual deposit/withdraw
 *   • Discounts — reusable named discounts for the register
 *   • Style — the shop's tagline + accent shown on its register
 *   • Shop settings — the per-shop tunables (min priced units, …)
 * Scoped to the caller's business by the API.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { renderSettingsForm } from './settings-form.js';
import { money } from '../lib/format.js';
import { tileGrid, openFocalMenu } from '../lib/tiles.js';
import { renderShopReport } from './shop-report.js';
import { renderShopNotices } from './shop-notices.js';

export function renderLedgerSettings(container, { me, onBusinessRenamed }) {
  const gridHost = el('div', {});
  mount(container, el('div.card', {}, [
    el('h2', {}, 'Shop Ledger'),
    el('p', { class: 'note' }, esc(me.business || 'Your shop') + ' — pick a section to open it.'),
    gridHost,
  ]));

  const sections = [
    { key: 'led-report', label: 'Performance', hint: 'Revenue & best sellers', glyph: '📈',
      open: (host) => renderShopReport(host) },
    { key: 'led-notices', label: 'Notices', hint: 'Post to your staff', glyph: '📣',
      open: (host) => renderShopNotices(host) },
    { key: 'led-coffer', label: 'Coffers', hint: 'Balance & ledger', glyph: '🪙',
      open: (host) => mount(host, cofferCard()) },
    { key: 'led-discounts', label: 'Discounts', hint: 'Reusable offers', glyph: '🏷️',
      open: (host) => mount(host, discountsCard()) },
    { key: 'led-style', label: 'Style', hint: 'Tagline & accent', glyph: '🎨',
      open: (host) => mount(host, styleCard()) },
    { key: 'led-storefront', label: 'Storefront', hint: 'Public share link', glyph: '🏪',
      open: (host) => mount(host, storefrontLinkCard(me)) },
    { key: 'led-export', label: 'Export', hint: 'Sales & coffer CSV', glyph: '📤',
      open: (host) => mount(host, exportCard()) },
    { key: 'led-company', label: 'Company', hint: 'Rename your shop', glyph: '🏛️',
      open: (host) => mount(host, companyCard(me, onBusinessRenamed)) },
    { key: 'led-settings', label: 'Shop settings', hint: 'Per-shop tunables', glyph: '⚙️',
      open: (host) => renderShopSettings(host) },
  ];

  function draw(images) {
    mount(gridHost, tileGrid(sections.map((s) => ({
      key: s.key, label: s.label, hint: s.hint, glyph: s.glyph,
      onOpen: () => openFocalMenu(s.label, (host) => s.open(host)),
    })), images));
  }
  draw({});
  api.getTiles().then((r) => draw(r.images || {})).catch(() => {});
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

/* ---- Public storefront share link ---- */
function storefrontLinkCard(me) {
  // The realm is part of the link: a visitor has no account, and two realms can
  // each have a shop of this name.
  const url = location.origin + location.pathname + '#/shop?b=' + encodeURIComponent(me.business || '') +
    (me.homeRealm && me.homeRealm !== 'default' ? '&realm=' + encodeURIComponent(me.homeRealm) : '');
  const box = el('input', { type: 'text', readonly: true, value: url });
  const status = el('p', {});
  const copy = el('button.secondary-btn', { onclick: async () => {
    try { await navigator.clipboard.writeText(url); status.className = 'ok'; status.textContent = 'Copied ✓'; }
    catch (e) { box.select(); status.className = ''; status.textContent = 'Press Ctrl/Cmd-C to copy.'; }
  } }, 'Copy link');
  const open = el('a', { class: 'secondary-btn', href: url, target: '_blank', rel: 'noopener' }, 'Preview');
  return el('div.card', {}, [
    el('h2', {}, 'Storefront'),
    el('p', { class: 'note' }, 'A public, read-only page of your wares (no sign-in) that customers can browse. Share this ' +
      'link. It only works while an admin has public storefronts enabled network-wide.'),
    box,
    el('div', { class: 'row-actions' }, [copy, open]),
    status,
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
