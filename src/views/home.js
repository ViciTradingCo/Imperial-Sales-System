/**
 * Home page — the signed-in landing. Shows the user's identity + status and the
 * per-role feature sections (stubs until each phase builds them). Settings,
 * employees, profile, etc. are reached from the nav, not here.
 */
import { el, mount, esc } from '../lib/dom.js';
import { navigate } from '../lib/router.js';

const ROLE_SECTIONS = {
  admin: [
    ['Core Dashboard', 'Registry, connect shops, sync pipeline, MOTD.', 'Phase 5'],
    ['Market Analysis', 'Network overviews, performance, pricing alerts.', 'Phase 6'],
    ['Register (POS)', 'Ring up sales for any shop.', 'Phase 3'],
  ],
  owner: [
    ['Register (POS)', 'Ring up sales for your shop.', 'Phase 3'],
    ['Shop Ledger', 'Inventory, discounts, style, Coffers.', 'Phase 4'],
  ],
  employee: [
    ['Register (POS)', 'Ring up sales for your shop.', 'Phase 3'],
  ],
};

export function renderHome(container, { me }) {
  const idCard = el('div.card', {}, [
    el('h2', {}, 'Welcome, ' + esc(me.character || 'trader')),
    el('p', { html:
      '<b>Business:</b> ' + esc(me.business || '—') + '<br>' +
      '<b>Role:</b> ' + esc(roleTitle(me.role)) + '<br>' +
      '<b>Status:</b> ' + statusBadge(me.status) }),
    me.status === 'pending'
      ? el('p', { class: 'warn', html:
          'Your account is <b>pending</b> — an owner or admin must activate it before you can ring up sales.' })
      : el('p', { class: 'ok' }, 'Your account is active.'),
    el('button', { class: 'secondary-btn', onclick: () => navigate('/profile') }, 'Edit profile & appearance'),
  ]);

  const sections = (ROLE_SECTIONS[me.role] || []).map(([title, desc, phase]) =>
    el('div.card.stub', {}, [
      el('h3', {}, title),
      el('p', { class: 'note' }, desc),
      el('span', { class: 'pill-soon' }, 'Arrives in ' + phase),
    ]));

  mount(container, idCard, ...sections);
}

function roleTitle(role) {
  return { admin: 'Administrator', owner: 'Shop Owner', employee: 'Employee' }[role] || 'Trader';
}
function statusBadge(status) {
  const cls = status === 'active' ? 'ok' : 'warn';
  return '<span class="' + cls + '">' + esc(status) + '</span>';
}
