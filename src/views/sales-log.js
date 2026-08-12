/**
 * Sales Log — everything that has already happened, in one place.
 *
 * The two histories used to live wherever the thing that WRITES them lives:
 * order lookup at the bottom of the register, deliveries at the bottom of
 * Inventory. That put a record you consult occasionally underneath a form you
 * use constantly, on both pages, and it split "what happened" across two
 * screens that are otherwise about doing rather than reading.
 *
 * They are the same kind of thing — goods and money that already moved, listed
 * newest first, each with the one correction it allows (void a sale, delete a
 * delivery). So they belong together, and away from the tills.
 *
 * The corrections stay here rather than being read-only: the moment you notice a
 * mistyped delivery is the moment you are looking at the list of deliveries.
 */
import { money, coins } from '../lib/format.js';
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { setOpsActions } from '../lib/sections.js';
import { canManage } from '../lib/roles.js';
import { tileGrid, sectionTiles } from '../lib/tiles.js';
import { skeletonRows } from '../lib/skeleton.js';
import { emptyState } from '../lib/empty.js';
import { toast } from '../lib/toast.js';

export function renderSalesLog(container, { me }) {
  setOpsActions(me); // stays on the shop-tools bar with Register / Inventory
  const canEdit = canManage(me);
  let tileImages = {};

  draw();
  // Artwork an admin has assigned, if any; the glyphs stand in until it lands.
  api.getTiles().then((r) => { tileImages = r.images || {}; draw(); }).catch(() => {});

  function draw() {
  mount(container, el('div.card', {}, [
    el('h2', {}, 'Sales Log'),
    el('p', { class: 'note' }, 'What has already happened — sales rung up, and deliveries taken in. ' +
      'Newest first.'),
    tileGrid(sectionTiles([
      { key: 'log-sales', label: 'Sales', hint: 'Find or void a past order', glyph: '🧾',
        open: (host) => renderSales(host) },
      { key: 'log-intake', label: 'Deliveries', hint: 'Intake you have recorded', glyph: '🚚',
        open: (host) => renderIntake(host, canEdit) },
    ]), tileImages),
  ]));
  }
}

/* ---- sales: search, and void ---- */

/** A sale's lines in THIS realm's denomination — the unit is applied on read. */
function saleLines(s) {
  const lines = (s && s.lines) || [];
  if (!lines.length) return String((s && s.items) || '');
  return lines.map((l) => l.name + ' x' + l.qty + ' @ ' + money(l.price)).join(', ');
}

function renderSales(host) {
  const q = el('input', { type: 'text', placeholder: 'Order #, customer, or employee' });
  const results = el('div', {}, skeletonRows(3));
  const search = el('button.secondary-btn', { onclick: run }, 'Search');

  async function run() {
    mount(results, skeletonRows(3));
    try {
      const res = await api.getSales(q.value.trim());
      renderResults(res.sales || []);
    } catch (e) {
      mount(results, el('p', { class: 'error' }, e.message || String(e)));
    }
  }

  // Enter searches, the way it would in any search box.
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });

  function renderResults(sales) {
    if (!sales.length) {
      mount(results, emptyState({ glyph: '🧾', title: 'No matching orders',
        hint: 'Leave the box blank to see the most recent sales.' }));
      return;
    }
    mount(results, ...sales.map((s) => {
      const voided = String(s.status).toUpperCase() === 'VOIDED';
      const card = el('div', { class: 'lookup-card' }, [
        el('p', { html:
          '<b>' + esc(s.orderNo) + '</b>' + (voided ? ' <span class="bad">VOIDED</span>' : '') +
          (s.staffPurchase ? ' <span class="role-pill">Employee purchase</span>' : '') + '<br>' +
          (s.staffPurchase ? 'No charge' : money(s.total)) + ' · ' + esc(s.customer || 'Walk-in') + ' · ' + esc(s.hold || '') + '<br>' +
          '<span class="note">' + esc(saleLines(s)) + '</span><br>' +
          '<span class="note">by ' + esc(s.employee || '') + (s.discount ? ' · ' + esc(s.discount) : '') + '</span>' }),
      ]);
      if (!voided) {
        card.appendChild(el('button.secondary-btn.small', {
          onclick: async () => {
            if (!confirm('Void ' + s.orderNo + '? This returns the items to stock.')) return;
            try { await api.voidSale(s.orderNo); toast('Order voided.', 'ok'); run(); }
            catch (e) { toast(e.message || String(e), 'error'); }
          },
        }, 'Void this sale'));
      }
      return card;
    }));
  }

  mount(host,
    el('p', { class: 'note' }, 'Search by order number, customer, or employee — or leave it blank for the latest sales.'),
    q, search, results);
  run();
}

/* ---- deliveries: what came in, and undoing one ---- */

function shortDate(ts) {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

function renderIntake(host, canEdit) {
  const listHost = el('div', {}, skeletonRows(3));
  mount(host,
    el('p', { class: 'note' }, 'Every delivery you have recorded. Deleting one puts its stock back out ' +
      'and refunds your coffer.'),
    listHost);

  /**
   * ONE ENTRY PER DELIVERY, with its items listed inside it.
   *
   * A trip that brought six things used to be six rows that happened to sit
   * next to each other — nothing said they arrived together, and the figure a
   * person actually handed over was not on the screen at all. The lines carry
   * the trip they belong to (`delivery`), so this is a grouping and not a
   * guess at one from matching timestamps.
   */
  function group(list) {
    const order = [];
    const by = new Map();
    list.forEach((r) => {
      if (!by.has(r.delivery)) { by.set(r.delivery, []); order.push(r.delivery); }
      // Unshift: the query is newest-first, so a delivery's own lines arrive
      // backwards. Within one trip they should read in the order they were typed.
      by.get(r.delivery).unshift(r);
    });
    return order.map((k) => by.get(k));
  }

  function draw(list) {
    if (!list.length) {
      mount(listHost, emptyState({ glyph: '🚚', title: 'No deliveries recorded yet',
        hint: 'Record an intake on the register’s Buying side and it will be listed here.' }));
      return;
    }
    mount(listHost, ...group(list).map(deliveryCard));
  }

  function deliveryCard(lines) {
    const first = lines[0];
    const total = lines.reduce((n, r) => n + coins(r.numItems * r.pricePer), 0);
    // A registered supplier in bold; otherwise whatever was typed.
    const from = first.fromBusiness
      ? ' from <b>' + esc(first.fromBusiness) + '</b>'
      : (first.vendor ? ' from ' + esc(first.vendor) : '');

    const head = el('p', { class: 'delivery-head', html:
      '<b>' + esc(shortDate(first.ts)) + '</b>' + from +
      (first.hold ? ' · ' + esc(first.hold) : '') +
      ' · <b>' + esc(money(total)) + '</b>' +
      (lines.length > 1 ? ' <span class="note">' + lines.length + ' items</span>' : '') });

    // Each line keeps its own Delete: a delivery is corrected a line at a time,
    // because the usual mistake is one wrong quantity among several right ones.
    const rows = lines.map((r) => {
      const row = el('div.emp-row', {}, [
        el('span', { html: '<b>' + esc(r.item) + '</b> ×' + r.numItems + ' @ ' + money(r.pricePer) +
          ' <span class="note">' + esc(money(r.numItems * r.pricePer)) + '</span>' }),
      ]);
      // The way to undo a mistyped delivery — sales have a void, intake had
      // nothing, so a wrong quantity used to be permanent.
      if (canEdit) {
        row.appendChild(el('span', { class: 'row-actions' }, [
          el('button.danger.small', { onclick: () => remove(r) }, 'Delete'),
        ]));
      }
      return row;
    });

    return el('div', { class: 'card delivery-card' }, [head, ...rows]);
  }

  async function remove(r) {
    if (!window.confirm('Delete this intake?\n\n' + r.item + ' ×' + r.numItems + ' @ ' + money(r.pricePer) +
      '\n\nThe stock it added comes back out and your coffer is refunded ' + money(r.numItems * r.pricePer) +
      '. The item stays listed in your inventory either way.')) return;
    try {
      const res = await api.deleteIntake(r.id);
      draw(res.intake || []);
      toast(res.shortBy
        ? 'Removed. Only ' + res.removed + ' could come back out — ' + res.shortBy + ' had already sold on.'
        : 'Intake removed and ' + money(res.refunded) + ' refunded.', res.shortBy ? 'warn' : 'ok');
    } catch (e) { toast(e.message || String(e), 'error'); }
  }

  api.getIntake()
    .then((r) => draw(r.intake || []))
    .catch((e) => mount(listHost, el('p', { class: 'error' }, e.message || String(e))));
}
