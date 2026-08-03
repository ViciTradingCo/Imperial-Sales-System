/**
 * Market Analysis (admin) — realm-wide analytics, split into sub-pages reached
 * from the action bar: Overview, Item Performance, Region Performance, Company
 * Performance, Trends. Read-only; the API enforces admin-only access.
 */
import { money, regionLabel, regionWord } from '../lib/format.js';
import { el, mount, esc, tableEl } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { setMarketActions } from '../lib/sections.js';

export function renderMarket(container, { tab } = {}) {
  setMarketActions(); // Market's own sub-pages; the side menu is the way back
  const host = el('div', {}, el('p', { class: 'note' }, 'Crunching the numbers…'));
  mount(container, el('div.card', {}, [
    el('h2', {}, 'Market Analysis'),
    el('p', { class: 'note' }, 'Performance across every shop in this realm. Voided sales are excluded.'),
    host,
  ]));

  api.getMarket()
    .then((d) => renderTab(host, tab || 'overview', d))
    .catch((e) => mount(host, el('p', { class: 'error' }, e.message || String(e))));
}

function renderTab(host, tab, d) {
  if (tab === 'items') return mount(host, itemPerformance(d.items || []));
  if (tab === 'regions') return mount(host, regionPerformance(d.holds || []));
  if (tab === 'companies') return mount(host, companyPerformance(d.businesses || []));
  if (tab === 'trends') return mount(host, trendsCard(d.trends || []));
  return mount(host, ...overview(d));
}

/**
 * The columns for each subject, defined ONCE.
 *
 * Overview's "Top 5" tables are previews of the pages below them, so they use
 * these too — a column added to Item Performance appears in its Top 5 without
 * anyone remembering to. They used to be written out separately and had already
 * drifted.
 *
 * Region headers are functions because a realm names its regions itself.
 */
const COMPANY_COLS = {
  headers: () => ['Company', 'Orders', 'Items', 'Revenue'],
  row: (b) => [b.business || '—', b.orders, b.items, money(b.revenue)],
};
const REGION_COLS = {
  headers: () => [regionLabel(), 'Orders', 'Items', 'Revenue'],
  row: (h) => [h.hold, h.orders, h.items, money(h.revenue)],
};
/**
 * Item Performance reports PRICES, not takings. What an admin needs from an
 * item is what it changes hands for — the total gold it has generated says more
 * about how often it sold than about the item.
 *
 * A dash means that side has no records yet; 0 would claim the item was traded
 * for nothing.
 */
const ITEM_COLS = {
  headers: () => ['Item', 'Qty sold', 'Orders', 'Avg bought', 'Avg sold', 'Avg value'],
  row: (i) => [i.item, i.qty, i.orders, avg(i.avgBought), avg(i.avgSold), avg(i.avgValue)],
};
function avg(v) { return v == null ? '—' : money(v); }

/* ---- Overview: top 5 of each category + alerts ---- */
function overview(d) {
  const o = d.overview || {};
  return [
    // No revenue tile: the headline figure people act on is activity, and the
    // gold total was the one number that made every other panel look secondary.
    statTiles([
      ['Orders', String(o.orders || 0)],
      ['Items sold', String(o.itemsSold || 0)],
      ['Active shops', String(o.activeShops || 0)],
    ]),
    tableCard('Top 5 companies', COMPANY_COLS.headers(),
      (d.businesses || []).slice(0, 5).map(COMPANY_COLS.row),
      'No sales recorded yet.'),
    tableCard('Top 5 ' + regionWord() + 's', REGION_COLS.headers(),
      (d.holds || []).slice(0, 5).map(REGION_COLS.row),
      'No sales with a ' + regionWord() + ' recorded yet.'),
    tableCard('Top 5 items', ITEM_COLS.headers(),
      (d.items || []).slice(0, 5).map(ITEM_COLS.row),
      'No items sold yet.'),
    alertsCard('⚠ Priced below cost', 'bad',
      (d.underpriced || []).map((u) =>
        '<b>' + esc(u.business) + '</b> · ' + esc(u.item) + ' — selling at ' +
        money(u.salePrice) + ' vs. avg cost ' + money(u.avgCost)),
      'No items are priced below their purchase cost.'),
    alertsCard('⤴ Overpriced (vs base value)', 'bad',
      (d.overpriced || []).map((o) =>
        '<b>' + esc(o.business) + '</b> · ' + esc(o.item) + ' — ' + money(o.price) +
        ' vs base ' + money(o.baseValue) + ' (' + o.ratio.toFixed(2) + '×)'),
      'No items are overpriced.'),
    alertsCard('⤵ Undercut (vs base value)', 'warn',
      (d.undercut || []).map((u) =>
        '<b>' + esc(u.business) + '</b> · ' + esc(u.item) + ' — ' + money(u.price) +
        ' vs base ' + money(u.baseValue) + ' (' + u.ratio.toFixed(2) + '×)'),
      'No items are undercut.'),
  ];
}

/* ---- Trends: daily revenue bars ---- */
function trendsCard(trends) {
  if (!trends.length) return el('div.card', {}, [el('h3', {}, 'Revenue trend'), el('p', { class: 'note' }, 'No sales yet.')]);
  const max = Math.max(...trends.map((t) => Number(t.revenue) || 0), 1);
  const bars = trends.map((t) => {
    const h = Math.round(((Number(t.revenue) || 0) / max) * 100);
    const bar = el('div', { class: 'trend-bar', title: t.day + ': ' + money(t.revenue) + ' · ' + t.orders + ' orders' },
      el('div', { class: 'trend-fill' }, ''));
    bar.querySelector('.trend-fill').style.height = h + '%';
    return el('div', { class: 'trend-col' }, [bar, el('div', { class: 'trend-day' }, String(t.day).slice(5))]);
  });
  return el('div.card', {}, [
    el('h3', {}, 'Revenue trend (last ' + trends.length + ' days)'),
    el('div', { class: 'trend-chart' }, bars),
  ]);
}

/* ---- Item Performance: searchable ---- */
function itemPerformance(items) {
  const search = el('input', { type: 'text', placeholder: 'Search items…' });
  const tableHost = el('div', {});
  function draw() {
    const q = search.value.trim().toLowerCase();
    const rows = items.filter((i) => !q || i.item.toLowerCase().includes(q));
    mount(tableHost, rows.length
      ? el('div', { class: 'table-scroll' }, tableEl(ITEM_COLS.headers(), rows.map(ITEM_COLS.row)))
      : el('p', { class: 'note' }, items.length ? 'No items match your search.' : 'No items sold yet.'));
  }
  search.addEventListener('input', draw);
  draw();
  return el('div.card', {}, [
    el('h3', {}, 'Item Performance'),
    el('p', { class: 'note' }, 'Average bought is what shops paid on intake, average sold is what customers ' +
      'paid, and average value is both together weighted by quantity — what the realm actually trades this ' +
      'item at, as opposed to its base value in the index.'),
    search,
    tableHost,
  ]);
}

/* ---- Region Performance ---- */
function regionPerformance(holds) {
  return tableCard(regionLabel() + ' Performance', REGION_COLS.headers(),
    holds.map(REGION_COLS.row),
    'No sales with a ' + regionWord() + ' recorded yet.');
}

/* ---- Company Performance ---- */
function companyPerformance(businesses) {
  return tableCard('Company Performance', COMPANY_COLS.headers(),
    businesses.map(COMPANY_COLS.row),
    'No sales recorded yet.');
}

/* ---- shared bits ---- */
export function statTiles(pairs) {
  return el('div', { class: 'stat-row' }, pairs.map(([label, value]) =>
    el('div', { class: 'stat-tile' }, [
      el('div', { class: 'stat-value' }, value),
      el('div', { class: 'stat-label' }, label),
    ])));
}

export function tableCard(title, headers, rows, emptyMsg) {
  const body = rows.length
    ? el('div', { class: 'table-scroll' }, tableEl(headers, rows))
    : el('p', { class: 'note' }, emptyMsg);
  return el('div.card', {}, [el('h3', {}, title), body]);
}

function alertsCard(title, cls, lines, emptyMsg) {
  const body = lines.length
    ? el('ul', { class: 'alert-list' }, lines.map((l) => el('li', { class: cls, html: l })))
    : el('p', { class: 'ok' }, emptyMsg);
  return el('div.card', {}, [el('h3', {}, title), body]);
}
