/**
 * Region Report — available to businesses the admins have marked as a "Court".
 * Shows the market for the Court's own hold: overview, the shops trading there,
 * and the items moving there. The API scopes it to the caller's hold and
 * refuses non-Court callers.
 */
import { money, regionLabel, regionWord } from '../lib/format.js';
import { el, mount } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { statTiles, tableCard } from './market.js';

export function renderRegionReport(container) {
  const host = el('div', {}, el('p', { class: 'note' }, 'Loading your ' + regionWord() + '’s report…'));
  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    el('h2', {}, regionLabel() + ' Report'),
    el('p', { class: 'note' }, 'Commerce in your ' + regionWord() + ', as its Court. Voided sales are excluded.'),
    host,
  ]));

  api.getRegionReport()
    .then((d) => {
      const o = d.overview || {};
      mount(host,
        el('div.card', {}, [el('h3', {}, d.hold || 'Your ' + regionWord())]),
        statTiles([
          ['Revenue', money(o.revenue)],
          ['Orders', String(o.orders || 0)],
          ['Items sold', String(o.itemsSold || 0)],
          ['Shops', String(o.activeShops || 0)],
        ]),
        tableCard('Shops trading in your ' + regionWord(), ['Company', 'Orders', 'Items', 'Revenue'],
          (d.businesses || []).map((b) => [b.business || '—', b.orders, b.items, money(b.revenue)]),
          'No sales recorded in your ' + regionWord() + ' yet.'),
        tableCard('Items moving in your ' + regionWord(), ['Item', 'Qty sold', 'Revenue'],
          (d.items || []).map((i) => [i.item, i.qty, money(i.revenue)]),
          'No items sold in your ' + regionWord() + ' yet.'),
      );
    })
    .catch((e) => mount(host, el('p', { class: 'error' }, e.message || String(e))));
}
