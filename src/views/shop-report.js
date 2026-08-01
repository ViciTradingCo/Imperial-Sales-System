/**
 * Shop performance (owner) — the owner-facing counterpart to network Market
 * Analysis, scoped to their own business: headline totals, a daily revenue
 * trend, and their best sellers.
 */
import { el, mount } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { skeletonLines } from '../lib/skeleton.js';
import { emptyState } from '../lib/empty.js';

export function renderShopReport(container) {
  const host = el('div', {}, skeletonLines(4));
  mount(container, host);

  api.getShopReport().then((r) => {
    const o = r.overview || {};
    if (!o.orders) {
      mount(host, emptyState({
        glyph: '📈', title: 'No sales yet',
        hint: 'Once your shop rings up its first sale, your revenue trend and best sellers appear here.',
      }));
      return;
    }
    mount(host,
      el('div', { class: 'stat-row' }, [
        stat('Revenue', money(o.revenue)),
        stat('Orders', String(o.orders)),
        stat('Items sold', String(o.itemsSold)),
      ]),
      el('h4', {}, 'Revenue — last 30 active days'),
      trendChart(r.trends || []),
      el('h4', {}, 'Best sellers'),
      topItems(r.items || []),
    );
  }).catch((e) => mount(host, el('p', { class: 'error' }, e.message || String(e))));
}

function stat(label, value) {
  return el('div', { class: 'stat-tile' }, [
    el('div', { class: 'stat-value' }, value),
    el('div', { class: 'stat-label' }, label),
  ]);
}

function trendChart(trends) {
  if (!trends.length) return el('p', { class: 'note' }, 'No activity yet.');
  const max = Math.max(...trends.map((t) => Number(t.revenue) || 0), 1);
  return el('div', { class: 'trend-chart' }, trends.map((t) => {
    const pct = Math.round(((Number(t.revenue) || 0) / max) * 100);
    return el('div', { class: 'trend-col', title: t.day + ' · ' + money(t.revenue) + ' · ' + t.orders + ' order(s)' }, [
      el('div', { class: 'trend-bar' }, [el('div', { class: 'trend-fill', style: 'height:' + pct + '%' })]),
      el('div', { class: 'trend-day' }, String(t.day || '').slice(5)),
    ]);
  }));
}

function topItems(items) {
  if (!items.length) return el('p', { class: 'note' }, 'No item sales recorded yet.');
  const max = Math.max(...items.map((i) => Number(i.revenue) || 0), 1);
  return el('div', { class: 'hbar-chart' }, items.slice(0, 10).map((i) => el('div', { class: 'hbar-row' }, [
    el('span', { class: 'hbar-label', title: i.item }, i.item),
    el('div', { class: 'hbar-track' }, [
      el('div', { class: 'hbar-fill', style: 'width:' + Math.round((Number(i.revenue) / max) * 100) + '%' }),
    ]),
    el('span', { class: 'hbar-val' }, money(i.revenue) + ' · ' + i.qty),
  ])));
}
