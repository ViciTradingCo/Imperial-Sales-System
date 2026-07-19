/**
 * Home page — the signed-in landing. Shows the user's identity + status and the
 * per-role feature sections (stubs until each phase builds them). Settings,
 * employees, profile, etc. are reached from the nav, not here.
 */
import { el, mount, esc } from '../lib/dom.js';
import { navigate } from '../lib/router.js';
import { setActions } from '../lib/actions.js';

const ROLE_SECTIONS = {
  admin: [
    ['Core Dashboard', 'Registry, connect shops, sync pipeline, MOTD.', 'Phase 5'],
  ],
  owner: [
    ['Shop Ledger', 'Discounts, style, Coffers, and more.', 'Phase 4'],
  ],
  employee: [],
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
  ]);

  const sections = (ROLE_SECTIONS[me.role] || []).map(([title, desc, phase]) =>
    el('div.card.stub', {}, [
      el('h3', {}, title),
      el('p', { class: 'note' }, desc),
      el('span', { class: 'pill-soon' }, 'Arrives in ' + phase),
    ]));

  mount(container, idCard, ...sections);

  // Admin gets quick links to the network-wide lists on the action bar.
  if (me.role === 'admin') {
    setActions([
      { label: 'Member List', onClick: () => navigate('/admin/members') },
      { label: 'Company List', onClick: () => navigate('/admin/companies') },
    ]);
  }
}

function roleTitle(role) {
  return { admin: 'Administrator', owner: 'Shop Owner', employee: 'Employee' }[role] || 'Trader';
}
function statusBadge(status) {
  const cls = status === 'active' ? 'ok' : 'warn';
  return '<span class="' + cls + '">' + esc(status) + '</span>';
}
