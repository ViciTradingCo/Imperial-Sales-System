/**
 * Market Analysis (admin) — network-wide performance and anomaly alerts over the
 * D1 store. Read-only. The API enforces admin-only access.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { money } from '../lib/format.js';
import { setAdminActions } from '../lib/sections.js';

export function renderMarket(container) {
  setAdminActions(); // keep the admin tools on the bar across sub-pages
  const host = el('div', {}, el('p', { class: 'note' }, 'Crunching the numbers…'));
  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    el('h2', {}, 'Market Analysis'),
    el('p', { class: 'note' }, 'Network-wide performance across every shop. Voided sales are excluded.'),
    host,
  ]));

  api.getMarket()
    .then(render)
    .catch((e) => mount(host, el('p', { class: 'error' }, e.message || String(e))));

  function render(d) {
    const o = d.overview || {};
    mount(host,
      statTiles([
        ['Revenue', money(o.revenue)],
        ['Orders', String(o.orders || 0)],
        ['Items sold', String(o.itemsSold || 0)],
        ['Active shops', String(o.activeShops || 0)],
      ]),
      tableCard('Performance by business', ['Business', 'Orders', 'Items', 'Revenue'],
        (d.businesses || []).map((b) => [b.business || '—', b.orders, b.items, money(b.revenue)]),
        'No sales recorded yet.'),
      tableCard('By hold', ['Hold', 'Orders', 'Items', 'Revenue'],
        (d.holds || []).map((h) => [h.hold, h.orders, h.items, money(h.revenue)]),
        'No sales with a hold recorded yet.'),
      alertsCard('⚠ Priced below cost', 'bad',
        (d.underpriced || []).map((u) =>
          '<b>' + esc(u.business) + '</b> · ' + esc(u.item) + ' — selling at ' +
          money(u.salePrice) + ' vs. avg cost ' + money(u.avgCost)),
        'No items are priced below their purchase cost.'),
      alertsCard('Low stock', 'warn',
        (d.lowStock || []).map((s) =>
          '<b>' + esc(s.business) + '</b> · ' + esc(s.item) + ' — ' + s.stock +
          ' left (threshold ' + s.lowStock + ')'),
        'No items are low on stock.'),
    );
  }
}

function statTiles(pairs) {
  return el('div', { class: 'stat-row' }, pairs.map(([label, value]) =>
    el('div', { class: 'stat-tile' }, [
      el('div', { class: 'stat-value' }, value),
      el('div', { class: 'stat-label' }, label),
    ])));
}

function tableCard(title, headers, rows, emptyMsg) {
  const body = rows.length
    ? el('div', { class: 'table-scroll' }, tableEl(headers, rows))
    : el('p', { class: 'note' }, emptyMsg);
  return el('div.card', {}, [el('h3', {}, title), body]);
}

function tableEl(headers, rows) {
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
