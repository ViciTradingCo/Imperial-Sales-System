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
import { money, formatDate } from '../lib/format.js';
import { tileGrid, sectionTiles } from '../lib/tiles.js';
import { renderShopReport } from './shop-report.js';
import { renderShopNotices } from './shop-notices.js';
import { renderSales, renderIntake } from './shop-history.js';
import { canManage, isOwner } from '../lib/roles.js';
import { signOut } from '../lib/auth.js';
import { reloadAsNewBusiness } from '../lib/businesses.js';
import { backToHome } from '../lib/sections.js';
import { openStocktakeModal } from './inventory.js';
import { bundlesCard, discountsCard } from './shop-deals.js';

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
  const sections = [
    // ONE tile for the two, because they answer the same question — "what do I
    // charge for this, other than the list price?" — and an owner setting up a
    // Friday deal should not have to know in advance whether the app files it
    // under a percentage or a basket.
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
  ];
  // OWNER-ONLY, and a tile of its own rather than a corner of Settings. A
  // manager runs the shop; ending it is not running it, and it is the one
  // action on this page that cannot be undone from the inside.
  if (isOwner(me)) {
    sections.push({ key: 'led-close', label: 'Close the Shop', hint: 'Shut it down for good', glyph: '🔒',
      open: (host) => mount(host, closeCard(me)) });
  }
  tilePage(container, {
    title: 'Shop Settings',
    note: (me.business || 'Your shop') + ' — how your shop is set up. Day-to-day figures are on the ' +
      'Shop Ledger tile at home; your staff code is on the Employees page, where you invite people.',
    sections,
  });
}

/**
 * CLOSING THE SHOP FOR GOOD.
 *
 * An owner's counterpart to Profile → Leave your shop, and it works on the same
 * principle: ending a thing is not erasing it. `closeCompany` ARCHIVES the
 * company — its sales, deliveries, coffer entries and time cards stay on the
 * network's books under a reserved name, and an admin can put the whole thing
 * back, figures and all, if this was a mistake.
 *
 * What the books no longer do is COUNT. A closed shop leaves Market Analysis
 * with its trade, because those figures describe the network as it stands and a
 * departed shop is not part of it. Kept, not counted — and the page has to say
 * both, since an owner reading "your books are kept" would otherwise reasonably
 * assume the market goes on quoting prices from a shop nobody can buy from.
 *
 * So the page LEADS with what is kept, in figures, before it offers the button.
 * "Delete my business" and "keep the books" are the same request, and an owner
 * should be able to see the second half is true before answering for the first.
 *
 * The name typed out is the confirmation, checked by the Worker rather than
 * here — a confirmation the client alone enforces is a confirmation a stale tab
 * can skip. Every refusal is the SERVER'S wording, for the same reason the
 * leave card uses `leaveRefusal`: the screen can never offer what will be
 * turned down.
 */
function closeCard(me) {
  const shop = me.business || 'your shop';
  const facts = el('div', {}, el('p', { class: 'note' }, 'Checking what closing would mean…'));
  const confirm = el('input', { type: 'text', placeholder: shop, autocomplete: 'off',
    'aria-label': 'Type the shop’s name to confirm' });
  const status = el('p', {});
  const close = el('button.danger', { onclick: doClose }, 'Close ' + shop + ' permanently');
  close.disabled = true;
  const setStatus = (m, c) => { status.className = c || ''; status.textContent = m || ''; };

  /**
   * The button opens only once the name is written out, and there is no second
   * "are you sure?" behind it — typing the shop's own name IS being sure, and a
   * dialog after it is a click people learn to dismiss without reading. The
   * Worker checks the same string, so this is convenience, not the safeguard.
   */
  let allowed = false;
  const matches = () => confirm.value.trim().toLowerCase() === shop.trim().toLowerCase();
  const sync = () => { close.disabled = !allowed || !matches(); };
  confirm.addEventListener('input', sync);

  api.closePreview().then((r) => {
    const kept = r.kept || {};
    const nodes = [
      el('p', { class: 'buy-total' }, 'Your books are kept'),
      el('p', { class: 'note' }, (kept.sales || 0) + ' sale' + (kept.sales === 1 ? '' : 's') + ' and ' +
        (kept.deliveries || 0) + ' deliver' + (kept.deliveries === 1 ? 'y' : 'ies') + ' stay on the ' +
        'network’s records, along with your coffer entries and everyone’s time cards. Nothing is erased, ' +
        'and an admin can restore the whole shop if this turns out to be a mistake.'),
      el('p', { class: 'note' }, 'They stop counting towards the market’s figures, though. A shop that ' +
        'has closed is no longer part of the market, so its trade leaves Market Analysis with it — and ' +
        'comes back with it if it is ever restored.'),
      el('p', { class: 'warn' }, 'What ends is the shop. It stops trading, its name is freed for someone ' +
        'else, and ' + (r.staff === 1 ? 'its 1 member' : 'all ' + (r.staff || 0) + ' of its members') +
        ' — you included — are taken off the roster. You cannot undo this yourself.'),
    ];
    if (r.refusal) nodes.push(el('p', { class: 'error' }, r.refusal));
    mount(facts, ...nodes);
    allowed = !!r.canClose;
    sync();
  }).catch((e) => mount(facts, el('p', { class: 'error' }, e.message || String(e))));

  async function doClose() {
    close.disabled = true;
    setStatus('Closing…', '');
    try {
      const res = await api.closeBusiness(confirm.value.trim());
      setStatus(res.closed + ' is closed.', 'ok');
      // Someone who runs two shops still belongs to the other, and the Worker has
      // already moved them onto it — so start again there rather than signing
      // them out of an account that is still good.
      if (res.remaining) reloadAsNewBusiness(); else signOut();
    } catch (e) {
      sync();
      setStatus(e.message || String(e), 'error');
    }
  }

  return el('div.card', {}, [
    el('h2', {}, 'Close ' + shop),
    el('p', { class: 'note' }, 'Shut the shop down for good. Use this when the business is finished — ' +
      'not to take a break, and not to rename it (that is under Settings).'),
    facts,
    el('label', {}, 'Type ' + shop + ' to confirm'),
    confirm,
    el('div', { class: 'row-actions' }, [close]),
    status,
  ]);
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
  return isNaN(d.getTime()) ? '' : formatDate(d);
}
