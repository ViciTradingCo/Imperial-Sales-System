/**
 * Home page — the signed-in landing.
 *   • Admins get the network tools on the action bar (Members/Companies/Items/MOTD/Audit/Settings).
 *   • Owners & employees get their business tools merged in here: the action bar
 *     is the Business Operations bar (Register/Inventory/Employees) and the page
 *     shows their subscription status.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { setAdminActions, setOpsActions, subscriptionCard } from '../lib/sections.js';

export function renderHome(container, { me }) {
  // Notices — the global MOTD plus any active per-business messages.
  const motdHost = el('div', {});
  api.getMotd().then((r) => {
    const notices = (r && r.notices) || [];
    if (notices.length) mount(motdHost, ...notices.map((n) =>
      el('div', { class: 'card motd-card' }, [el('h3', {}, '📜 Notice'), el('p', {}, n)])));
  }).catch(() => { /* banners are non-critical */ });

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

  const nodes = [motdHost, idCard];

  if (me.role === 'admin') {
    setAdminActions();
  } else {
    // Business Operations lives here for owners/employees.
    setOpsActions(me);
    nodes.push(subscriptionCard(me));
  }

  mount(container, ...nodes);
}

function roleTitle(role) {
  return { admin: 'Administrator', owner: 'Shop Owner', employee: 'Employee' }[role] || 'Trader';
}
function statusBadge(status) {
  const cls = status === 'active' ? 'ok' : 'warn';
  return '<span class="' + cls + '">' + esc(status) + '</span>';
}
