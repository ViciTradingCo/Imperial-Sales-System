/**
 * Low / out-of-stock report — items that are out, and items at or below their
 * own Low Stock threshold, worst first.
 *
 * It appears in two places, and the difference is deliberate. As a PAGE, from
 * the Restock button on Home: you went looking for it, so it gets a URL you can
 * come back to. As a MODAL, from the restock nudge on the banner: you were in
 * the middle of something else and the app interrupted, so it must be dismissable
 * without losing where you were.
 *
 * Both render the same body, from one function — two copies of a report is how
 * one of them ends up a version behind.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { openModal } from '../lib/modal.js';
import { setOpsActions } from '../lib/sections.js';
import { money } from '../lib/format.js';

/** Fills `host` with the report. Shared by the page and the modal. */
function fillReport(host) {
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
}

/** The Restock page, reached from Home. */
export function renderLowStock(container, { me }) {
  setOpsActions(me); // keeps the shop-tools bar, like every other shop page
  const host = el('div', {}, el('p', { class: 'note' }, 'Loading…'));
  mount(container, el('div.card', {}, [
    el('h2', {}, 'Restock'),
    el('p', { class: 'note' }, 'What has run out, and what is close to it. "Low" means at or below an ' +
      'item’s own Low Stock number, which you set when editing the item.'),
    host,
  ]));
  fillReport(host);
}

/** The same report as a focal window, for the nudge on the banner. */
export function openLowStockModal() {
  const host = el('div', {}, el('p', { class: 'note' }, 'Loading…'));
  openModal([el('h3', {}, 'Restock report'), host]);
  fillReport(host);
}
