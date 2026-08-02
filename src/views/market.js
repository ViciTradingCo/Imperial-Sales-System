/**
 * Market Analysis (admin) — realm-wide analytics, split into sub-pages reached
 * from the action bar: Overview, Item Performance, Region Performance, Company
 * Performance, Trends. Read-only; the API enforces admin-only access.
 */
import { el, mount, esc } from '../lib/dom.js';
import { regionLabel, regionWord } from '../lib/format.js';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
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
  if (tab === 'holds') return mount(host, holdPerformance(d.holds || []));
  if (tab === 'companies') return mount(host, companyPerformance(d.businesses || []));
  if (tab === 'trends') return mount(host, trendsCard(d.trends || []));
  return mount(host, ...overview(d));
}

/* ---- Overview: top 5 of each category + alerts ---- */
function overview(d) {
  const o = d.overview || {};
  return [
    statTiles([
      ['Revenue', money(o.revenue)],
      ['Orders', String(o.orders || 0)],
      ['Items sold', String(o.itemsSold || 0)],
      ['Active shops', String(o.activeShops || 0)],
    ]),
    tableCard('Top 5 companies', ['Company', 'Orders', 'Items', 'Revenue'],
      (d.businesses || []).slice(0, 5).map((b) => [b.business || '—', b.orders, b.items, money(b.revenue)]),
      'No sales recorded yet.'),
    tableCard('Top 5 ' + regionWord() + 's', [regionLabel(), 'Orders', 'Items', 'Revenue'],
      (d.holds || []).slice(0, 5).map((h) => [h.hold, h.orders, h.items, money(h.revenue)]),
      'No sales with a hold recorded yet.'),
    tableCard('Top 5 items', ['Item', 'Qty sold', 'Revenue'],
      (d.items || []).slice(0, 5).map((i) => [i.item, i.qty, money(i.revenue)]),
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
      ? el('div', { class: 'table-scroll' }, tableEl(['Item', 'Qty sold', 'Orders', 'Revenue'],
          rows.map((i) => [i.item, i.qty, i.orders, money(i.revenue)])))
      : el('p', { class: 'note' }, items.length ? 'No items match your search.' : 'No items sold yet.'));
  }
  search.addEventListener('input', draw);
  draw();
  return el('div.card', {}, [el('h3', {}, 'Item Performance'), search, tableHost]);
}

/* ---- Region Performance ---- */
function holdPerformance(holds) {
  return tableCard(regionLabel() + ' Performance', [regionLabel(), 'Orders', 'Items', 'Revenue'],
    holds.map((h) => [h.hold, h.orders, h.items, money(h.revenue)]),
    'No sales with a hold recorded yet.');
}

/* ---- Company Performance ---- */
function companyPerformance(businesses) {
  return tableCard('Company Performance', ['Company', 'Orders', 'Items', 'Revenue'],
    businesses.map((b) => [b.business || '—', b.orders, b.items, money(b.revenue)]),
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

export function tableEl(headers, rows) {
  const thead = el('tr', {}, headers.map((h) => el('th', {}, h)));
  const trs = rows.map((r) => el('tr', {}, r.map((c) => el('td', {}, String(c)))));
  return el('table', { class: 'data-table' }, [el('thead', {}, thead), el('tbody', {}, trs)]);
}

function alertsCard(title, cls, lines, emptyMsg) {
  const body = lines.length
    ? el('ul', { class: 'alert-list' }, lines.map((l) => el('li', { class: cls, html: l })))
    : el('p', { class: 'ok' }, emptyMsg);
  return el('div.card', {}, [el('h3', {}, title), body]);
}
