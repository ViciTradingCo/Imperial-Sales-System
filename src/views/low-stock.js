/**
 * Low / out-of-stock report — a focal window (modal) an owner opens from the
 * restock nudge on Home. Lists items that are out of stock and items at or below
 * their Low Stock threshold, worst first.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { openModal } from '../lib/modal.js';
import { money } from '../lib/format.js';

export function openLowStockModal() {
  const host = el('div', {}, el('p', { class: 'note' }, 'Loading…'));
  const modal = openModal([el('h3', {}, 'Restock report'), host]);

  api.getLowStock().then((r) => {
    const out = r.out || [], low = r.low || [];
    if (!out.length && !low.length) {
      mount(host, el('p', { class: 'note ok' }, 'Everything is stocked — nothing low or out. ✓'));
      return;
    }
    const nodes = [];
    if (out.length) {
      nodes.push(el('h4', {}, 'Out of stock (' + out.length + ')'));
      out.forEach((it) => nodes.push(row(it, true)));
    }
    if (low.length) {
      nodes.push(el('h4', {}, 'Running low (' + low.length + ')'));
      low.forEach((it) => nodes.push(row(it, false)));
    }
    mount(host, ...nodes);
  }).catch((e) => mount(host, el('p', { class: 'error' }, e.message || String(e))));

  function row(it, isOut) {
    return el('div', { class: 'member-row' }, [
      el('p', { html: '<b>' + esc(it.item) + '</b> · <span class="note">' +
        (isOut ? 'out of stock' : 'stock ' + it.stock + ' ≤ low ' + it.lowStock) +
        ' · ' + esc(money(it.price)) + '</span>' }),
      el('span', { class: isOut ? 'pill danger' : 'pill warn' }, isOut ? 'OUT' : 'LOW'),
    ]);
  }
  return modal;
}
