/**
 * Court Tools — the government of a region, for the company an admin has
 * flagged as its Court.
 *
 * EVERY Court-specific capability lives on this one page, as tiles: what it can
 * see (the region's market, its companies, its stock) and what it can do (set a
 * levy, licence and sanction shops, cap prices, post a notice, spend public
 * money). A Court is also an ordinary shop, and mixing the two sets of tools
 * would leave neither legible.
 *
 * The REGION is the boundary throughout. The Worker resolves the Court's own
 * region from its own company and scopes every read and write to it; this
 * screen only draws what comes back.
 *
 * THE MONEY NEVER MOVES ON ITS OWN. A levy accrues as a debt and a Court records
 * payment when it is actually paid — the system does not reach into a player's
 * coffer and take it.
 */
import { el, mount, esc, tableEl, statTiles } from '../lib/dom.js';
import { money, regionWord } from '../lib/format.js';
import { api } from '../lib/api.js';
import { tileGrid, sectionTiles, openFocalMenu } from '../lib/tiles.js';
import { navigate } from '../lib/router.js';
import { toast } from '../lib/toast.js';
import { createItemPicker } from '../lib/item-picker.js';
import { renderRegionReport } from './region-report.js';
import { skeletonRows } from '../lib/skeleton.js';

/** The list of shops trading in this Court's region. */
export function renderCourtCompanies(container) {
  const listHost = el('div', {}, skeletonRows(4));
  const search = el('input', { type: 'search', placeholder: 'Search company or contact…' });
  let all = [];
  let hold = '';
  search.addEventListener('input', draw);

  mount(container,
    el('p', { class: 'note' }, 'Every company trading in your ' + regionWord() + '. Opening one shows its ' +
      'roster and its books — as its Court, you may look, but not change anything.'),
    search,
    listHost);

  api.getCourtCompanies()
    .then((d) => { all = d.companies || []; hold = d.hold || ''; draw(); })
    .catch((e) => mount(listHost, el('p', { class: 'error' }, e.message || String(e))));

  function draw() {
    const q = search.value.trim().toLowerCase();
    const rows = all.filter((c) => !q ||
      [c.business, c.pointOfContact, c.status].some((v) => String(v || '').toLowerCase().includes(q)));
    if (!rows.length) {
      mount(listHost, el('p', { class: 'note' }, all.length
        ? 'No matches.'
        : 'No companies are registered in ' + (hold || 'your ' + regionWord()) + ' yet.'));
      return;
    }
    mount(listHost, ...rows.map((c) => {
      const statusCls = String(c.status).toUpperCase() === 'VALID' ? 'ok' : 'bad';
      const sub = c.perpetual ? 'Perpetual' : (c.until ? 'certified until ' + c.until : 'no subscription');
      return el('div', { class: 'member-row' }, [
        el('p', { html:
          '<b>' + esc(c.business || '—') + '</b> · <span class="' + statusCls + '">' + esc(c.status || '—') + '</span>' +
          (c.court ? ' <span class="role-pill">Court</span>' : '') + '<br>' +
          '<span class="note">' + esc(sub) + (c.pointOfContact ? ' · ' + esc(c.pointOfContact) : '') + '</span>' }),
        el('span', { class: 'row-actions' }, [
          el('button.primary.small', { onclick: () => openCourtShop(c.business) }, 'Open'),
        ]),
      ]);
    }));
  }
}

/** One shop in the region: its roster, its treasury, and how it is trading. */
function openCourtShop(business) {
  openFocalMenu(business, (host) => {
    mount(host, el('p', { class: 'note' }, 'Loading…'));
    api.getCourtCompany(business)
      .then((d) => mount(host, ...shopBody(d)))
      .catch((e) => mount(host, el('p', { class: 'error' }, e.message || String(e))));
  });
}

function shopBody(d) {
  const o = d.overview || {};
  const coffer = d.coffer || {};
  const entries = coffer.entries || [];
  const roster = d.roster || [];
  const discounts = d.discounts || [];
  const style = d.style || {};

  const nodes = [
    el('p', { class: 'note' }, 'Read only — what this company reports to its ' + regionWord() + '.'),
    statTiles([
      ['Coffer', money(coffer.balance || 0)],
      ['Revenue', money(o.revenue || 0)],
      ['Orders', String(o.orders || 0)],
      ['Items sold', String(o.itemsSold || 0)],
    ]),
    el('h4', {}, 'Staff'),
  ];

  nodes.push(roster.length
    ? el('div', { class: 'table-scroll' }, tableEl(['Name', 'Role', 'Status'],
        roster.map((p) => [p.character, p.isOwner ? 'Owner' : roleLabel(p.role), p.status])))
    : el('p', { class: 'note' }, 'Nobody registered to this company.'));

  nodes.push(el('h4', {}, 'Recent coffer activity'));
  nodes.push(entries.length
    ? el('div', {}, entries.slice(0, 15).map((e) => el('div.emp-row', {}, [
        el('span', { html: '<b>' + (Number(e.amount) >= 0 ? '+' : '') + esc(money(e.amount)) + '</b> ' +
          '<span class="note">' + esc(e.kind) + (e.note ? ' · ' + esc(e.note) : '') + ' · ' +
          esc(String(e.ts || '').slice(0, 10)) + '</span>' }),
      ])))
    : el('p', { class: 'note' }, 'No coffer activity yet.'));

  nodes.push(el('h4', {}, 'Top items'));
  nodes.push((d.items || []).length
    ? el('div', { class: 'table-scroll' }, tableEl(['Item', 'Qty sold', 'Revenue'],
        d.items.map((i) => [i.item, i.qty, money(i.revenue)])))
    : el('p', { class: 'note' }, 'Nothing sold yet.'));

  nodes.push(el('h4', {}, 'Discounts'));
  nodes.push(discounts.length
    ? el('div', {}, discounts.map((x) => el('p', { class: 'note' }, x.name + ' — ' + x.percent + '%')))
    : el('p', { class: 'note' }, 'No named discounts.'));

  if (style.tagline) nodes.push(el('p', { class: 'shop-tagline' }, style.tagline));
  return nodes;
}

function roleLabel(role) {
  return { owner: 'Shop Owner', employee: 'Employee', admin: 'Admin' }[role] || role || '';
}

/* ==== the Court Tools page ==== */

/**
 * The page itself: a tile per capability. Loads the Court's own state once so
 * the tiles can carry live figures — an admin should see what the levy is set
 * to without opening it.
 */
export function renderCourtTools(container, { me } = {}) {
  const gridHost = el('div', {}, skeletonRows(3));
  const head = el('div', {});
  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    el('h2', {}, '⚖️ Court Tools'),
    head,
    gridHost,
  ]));

  let state = null;
  function load() {
    api.getCourt()
      .then((d) => { state = d; draw(); })
      .catch((e) => {
        mount(head, el('p', { class: 'error' }, e.message || String(e)));
        mount(gridHost);
      });
  }

  function draw() {
    const levy = state.settings.taxPercent;
    mount(head,
      el('p', { class: 'note' }, 'You govern trade in ' + esc(state.hold) + ' — ' + state.shops +
        ' compan' + (state.shops === 1 ? 'y' : 'ies') + ' trade here. Everything below covers the whole ' +
        regionWord() + ', not just your own shop.'),
      statTiles([
        ['Levy', levy ? levy + '%' : 'Disabled'],
        ['Owed to you', money(state.dues.total)],
      ]));

    mount(gridHost, tileGrid(sectionTiles([
      { key: 'court-market', label: 'Market', hint: 'Trade in your ' + regionWord(), glyph: '📊',
        open: (h) => renderRegionReport(h) },
      { key: 'court-companies', label: 'Companies', hint: 'Shops, rosters & books', glyph: '🏛️',
        open: (h) => renderCourtCompanies(h) },
      { key: 'court-levy', label: 'Levy', hint: levy ? levy + '% of each sale' : 'Off', glyph: '🪙',
        open: (h) => levyPanel(h, state, load) },
      { key: 'court-dues', label: 'Dues', hint: money(state.dues.total) + ' owed', glyph: '📜',
        open: (h) => duesPanel(h, load) },
      { key: 'court-licences', label: 'Licences', hint: 'Seals & sanctions', glyph: '🛡️',
        open: (h) => standingsPanel(h, state, load) },
      { key: 'court-prices', label: 'Price controls', hint: 'Floors & ceilings', glyph: '⚖️',
        open: (h) => pricesPanel(h) },
      { key: 'court-notice', label: 'Notice', hint: state.settings.notice ? 'Posted' : 'None', glyph: '📣',
        open: (h) => noticePanel(h, state, load) },
      { key: 'court-treasury', label: 'Treasury', hint: 'Public spending', glyph: '🏦',
        open: (h) => treasuryPanel(h) },
      { key: 'court-stock', label: 'Stock', hint: 'What the ' + regionWord() + ' holds', glyph: '📦',
        open: (h) => stockPanel(h) },
    ], navigate), {}));
  }

  load();
}

/* ---- the levy ---- */
function levyPanel(host, state, onSaved) {
  const pct = el('input', { type: 'number', min: '0', max: '100', step: '0.5', value: String(state.settings.taxPercent) });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Set levy');
  const setStatus = (m, c) => { status.className = c || ''; status.textContent = m; };

  async function doSave() {
    save.disabled = true; setStatus('Saving…', '');
    try {
      const r = await api.saveCourtSettings({ taxPercent: pct.value });
      setStatus(r.settings.taxPercent ? 'Levy set to ' + r.settings.taxPercent + '%.' : 'Levy disabled.', 'ok');
      onSaved();
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { save.disabled = false; }
  }

  mount(host,
    el('p', { class: 'note' }, 'A share of every sale made in your ' + regionWord() + ', recorded as a debt the ' +
      'shop owes you. Nothing is taken automatically — you mark dues paid under Dues when they actually are.'),
    el('p', { class: 'note' }, 'Set it to 0 to switch the levy off entirely: no debt is recorded and the register ' +
      'does not work out a share of anything.'),
    el('label', {}, 'Levy (% of each sale)'), pct,
    save, status);
}

/* ---- dues owed ---- */
function duesPanel(host, onPaid) {
  const listHost = el('div', {}, skeletonRows(3));
  mount(host,
    el('p', { class: 'note' }, 'What each shop owes in levies, less what it has paid. Recording a payment ' +
      'credits your own coffer — do it when the coin actually changes hands.'),
    listHost);

  function load() {
    api.getCourtDues()
      .then((d) => draw(d))
      .catch((e) => mount(listHost, el('p', { class: 'error' }, e.message || String(e))));
  }

  function draw(d) {
    const shops = (d.shops || []).filter((s) => s.owed !== 0);
    if (!shops.length) { mount(listHost, el('p', { class: 'note ok' }, 'Nothing outstanding.')); return; }
    mount(listHost,
      el('p', { html: '<b>' + esc(money(d.total)) + '</b> outstanding across ' + shops.length + ' shop(s).' }),
      ...shops.map((s) => el('div', { class: 'member-row' }, [
        el('p', { html: '<b>' + esc(s.business) + '</b> · <span class="note">' + esc(money(s.owed)) + ' owed</span>' }),
        el('span', { class: 'row-actions' }, [
          el('button.primary.small', { onclick: () => pay(s) }, 'Record payment'),
          el('button.secondary-btn.small', { onclick: () => history(s.business) }, 'History'),
        ]),
      ])));
  }

  async function pay(s) {
    const raw = window.prompt('How much has ' + s.business + ' paid?\n\nOutstanding: ' + money(s.owed), String(s.owed));
    if (raw === null) return;
    try {
      await api.payCourtDues(s.business, raw, '');
      toast('Payment recorded and added to your coffer.', 'ok');
      load();
      onPaid();
    } catch (e) { toast(e.message || String(e), 'error'); }
  }

  function history(business) {
    openFocalMenu(business + ' — levies', (h) => {
      mount(h, el('p', { class: 'note' }, 'Loading…'));
      api.getCourtDues(business)
        .then((d) => mount(h, (d.entries || []).length
          ? el('div', { class: 'table-scroll' }, tableEl(['When', 'Kind', 'Amount', 'Order'],
              d.entries.map((e) => [String(e.ts).slice(0, 10), e.kind, money(e.amount), e.note || ''])))
          : el('p', { class: 'note' }, 'Nothing recorded yet.')))
        .catch((e) => mount(h, el('p', { class: 'error' }, e.message || String(e))));
    });
  }

  load();
}

/* ---- licences and sanctions ---- */
const STANDING_LABEL = {
  licensed: 'Licensed', none: 'No ruling', restricted: 'Restricted', banned: 'Barred from trading',
};
function standingsPanel(host, state, onChanged) {
  const listHost = el('div', {});
  mount(host,
    el('p', { class: 'note' }, 'Your ruling on each shop trading here. A licence puts your seal on its public ' +
      'storefront; a restriction warns visitors; barring one stops it selling until you lift it.'),
    listHost);

  let rows = state.standings || [];
  function draw() {
    mount(listHost, ...rows.map((c) => {
      const sel = el('select', {});
      ['licensed', 'none', 'restricted', 'banned'].forEach((v) =>
        sel.appendChild(el('option', { value: v }, STANDING_LABEL[v])));
      sel.value = c.standing;
      sel.disabled = !!c.court;   // a Court rules on others, not on itself
      sel.addEventListener('change', () => apply(c, sel));
      const cls = c.standing === 'banned' || c.standing === 'restricted' ? 'bad'
        : c.standing === 'licensed' ? 'ok' : 'note';
      return el('div', { class: 'member-row' }, [
        el('p', { html: '<b>' + esc(c.business) + '</b>' + (c.court ? ' <span class="role-pill">Court</span>' : '') +
          '<br><span class="' + cls + '">' + esc(STANDING_LABEL[c.standing] || c.standing) + '</span>' +
          (c.note ? ' <span class="note">· ' + esc(c.note) + '</span>' : '') }),
        el('span', { class: 'row-actions' }, [sel]),
      ]);
    }));
  }

  async function apply(c, sel) {
    const value = sel.value;
    // A sanction is worth a reason: the shop is told, and a Court that cannot
    // say why is one nobody can argue with.
    const note = value === 'restricted' || value === 'banned'
      ? (window.prompt('Reason for ' + STANDING_LABEL[value].toLowerCase() + ' ' + c.business + '? (optional)') || '')
      : '';
    try {
      const r = await api.setCourtStanding(c.business, value, note);
      rows = r.standings || rows;
      draw();
      toast(c.business + ' — ' + STANDING_LABEL[value] + '.', 'ok');
      onChanged();
    } catch (e) { sel.value = c.standing; toast(e.message || String(e), 'error'); }
  }

  draw();
}

/* ---- price controls ---- */
function pricesPanel(host) {
  const listHost = el('div', {}, skeletonRows(2));
  const picker = createItemPicker({ placeholder: 'Item to control…' });
  const min = el('input', { type: 'number', min: '0', step: '0.01', placeholder: 'Floor (optional)' });
  const max = el('input', { type: 'number', min: '0', step: '0.01', placeholder: 'Ceiling (optional)' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Set control');
  const setStatus = (m, c) => { status.className = c || ''; status.textContent = m; };
  api.getItems().then((r) => picker.setItems(r.items || [])).catch(() => {});

  mount(host,
    el('p', { class: 'note' }, 'A floor and a ceiling on what may be charged for an item anywhere in your ' +
      regionWord() + '. The register refuses a sale outside them and tells the clerk the bound.'),
    listHost,
    el('label', {}, 'Item'), picker.el,
    el('div', { class: 'craft-row' }, [min, max]),
    el('p', { class: 'note' }, 'Leave both blank to lift the control on that item.'),
    save, status);

  function load() {
    api.getCourtPrices()
      .then((d) => draw(d.prices || []))
      .catch((e) => mount(listHost, el('p', { class: 'error' }, e.message || String(e))));
  }
  function draw(prices) {
    mount(listHost, prices.length
      ? el('div', { class: 'table-scroll' }, tableEl(['Item', 'Floor', 'Ceiling'],
          prices.map((p) => [p.item, p.min == null ? '—' : money(p.min), p.max == null ? '—' : money(p.max)])))
      : el('p', { class: 'note' }, 'No price controls in force.'));
  }

  async function doSave() {
    const item = picker.value();
    if (!item) { setStatus('Pick an item.', 'error'); return; }
    save.disabled = true; setStatus('Saving…', '');
    try {
      draw((await api.saveCourtPrice(item, min.value, max.value)).prices || []);
      picker.clear(); min.value = ''; max.value = '';
      setStatus('Saved.', 'ok');
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { save.disabled = false; }
  }

  load();
}

/* ---- the region's notice ---- */
function noticePanel(host, state, onSaved) {
  const body = el('textarea', { rows: '5', placeholder: 'An announcement to every shop trading here…' });
  body.value = state.settings.notice || '';
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSave }, 'Post notice');
  const setStatus = (m, c) => { status.className = c || ''; status.textContent = m; };

  async function doSave() {
    save.disabled = true; setStatus('Saving…', '');
    try {
      await api.saveCourtSettings({ notice: body.value });
      api.bustMotd();   // shops should see it on their next page, not in 30s
      setStatus(body.value.trim() ? 'Posted.' : 'Notice cleared.', 'ok');
      onSaved();
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { save.disabled = false; }
  }

  mount(host,
    el('p', { class: 'note' }, 'Shown on the home screen of every shop trading in your ' + regionWord() + ', ' +
      'alongside the network’s own notices. Clear the box to take it down.'),
    body, save, status);
}

/* ---- the treasury ---- */
function treasuryPanel(host) {
  const summary = el('div', {}, skeletonRows(2));
  const cat = el('select', {});
  const amount = el('input', { type: 'number', min: '0', step: '0.01', placeholder: 'Amount' });
  const note = el('input', { type: 'text', placeholder: 'What for? (optional)' });
  const status = el('p', {});
  const save = el('button.primary', { onclick: doSpend }, 'Record spending');
  const setStatus = (m, c) => { status.className = c || ''; status.textContent = m; };

  mount(host,
    el('p', { class: 'note' }, 'Public money going out, by category. Each entry debits your own coffer, so your ' +
      'treasury and your accounts always agree.'),
    summary,
    el('label', {}, 'Category'), cat,
    el('label', {}, 'Amount'), amount,
    el('label', {}, 'Note'), note,
    save, status);

  function load() {
    api.getCourtSpending()
      .then((d) => {
        if (!cat.children.length) (d.categories || []).forEach((c) => cat.appendChild(el('option', { value: c }, c)));
        draw(d);
      })
      .catch((e) => mount(summary, el('p', { class: 'error' }, e.message || String(e))));
  }
  function draw(d) {
    mount(summary,
      el('p', { html: '<b>' + esc(money(d.total)) + '</b> spent in total.' }),
      (d.byCategory || []).length
        ? el('div', { class: 'table-scroll' }, tableEl(['Category', 'Spent'],
            d.byCategory.map((c) => [c.category, money(c.amount)])))
        : el('p', { class: 'note' }, 'Nothing spent yet.'),
      (d.entries || []).length
        ? el('div', { class: 'table-scroll' }, tableEl(['When', 'Category', 'Amount', 'Note'],
            d.entries.slice(0, 20).map((e) => [String(e.ts).slice(0, 10), e.category, money(e.amount), e.note || ''])))
        : el('span', {}));
  }

  async function doSpend() {
    save.disabled = true; setStatus('Saving…', '');
    try {
      draw(await api.spendCourt(cat.value, amount.value, note.value.trim()));
      amount.value = ''; note.value = '';
      setStatus('Recorded.', 'ok');
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { save.disabled = false; }
  }

  load();
}

/* ---- what the region holds ---- */
function stockPanel(host) {
  const listHost = el('div', {}, skeletonRows(4));
  const search = el('input', { type: 'search', placeholder: 'Search items…' });
  let all = [];
  search.addEventListener('input', draw);

  mount(host,
    el('p', { class: 'note' }, 'Everything held by every shop in your ' + regionWord() + '. Crafting materials ' +
      'are counted separately — stock somebody is keeping to make things with is not stock for sale.'),
    search, listHost);

  function draw() {
    const q = search.value.trim().toLowerCase();
    const rows = all.filter((r) => !q || r.item.toLowerCase().includes(q));
    mount(listHost, rows.length
      ? el('div', { class: 'table-scroll' }, tableEl(['Item', 'For sale', 'Materials', 'Shops', 'Avg price'],
          rows.slice(0, 200).map((r) => [r.item, r.forSale, r.materials, r.shops,
            r.avgPrice == null ? '—' : money(r.avgPrice)])))
      : el('p', { class: 'note' }, all.length ? 'No matches.' : 'Nothing stocked in your ' + regionWord() + ' yet.'));
  }

  api.getCourtStock()
    .then((d) => { all = d.stock || []; draw(); })
    .catch((e) => mount(listHost, el('p', { class: 'error' }, e.message || String(e))));
}
