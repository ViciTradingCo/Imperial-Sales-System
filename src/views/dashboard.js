/**
 * Role-scoped landing view. What a signed-in, registered user sees:
 *   • Everyone   — their identity card + the sections their role can reach.
 *   • Owner/admin — a working Employee Management panel (list + activate the
 *                   pending accounts that joined their business).
 *
 * The per-role feature sections (Register, Ledger, Core, Market) are stubs here;
 * each is filled in by its own phase. They render only for roles the API would
 * actually serve, so the role gating is visible end to end.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
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

export function renderDashboard(container, { me }) {
  const idCard = el('div.card', {}, [
    el('h2', {}, 'East Empire — ' + roleTitle(me.role)),
    el('p', { html:
      '<b>Character:</b> ' + esc(me.character || '—') + '<br>' +
      '<b>Business:</b> ' + esc(me.business || '—') + '<br>' +
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

  const nodes = [idCard];

  // Admins get a live entry to the network-wide Master Settings.
  if (me.role === 'admin') {
    nodes.push(el('div.card', {}, [
      el('h3', {}, 'Network Settings'),
      el('p', { class: 'note' }, 'Tune sync cadence and market anomaly thresholds for the whole network.'),
      el('button.primary', { onclick: () => navigate('/admin/settings') }, 'Open Network Settings'),
    ]));
  }

  // Owners get a live entry to their own shop's ledger settings.
  if (me.role === 'owner') {
    nodes.push(el('div.card', {}, [
      el('h3', {}, 'Ledger Settings'),
      el('p', { class: 'note' }, 'Per-shop settings for your business, like the pricing-flag threshold.'),
      el('button.primary', { onclick: () => navigate('/ledger/settings') }, 'Open Ledger Settings'),
    ]));
  }

  nodes.push(...sections);

  if (me.role === 'owner' || me.role === 'admin') {
    nodes.push(renderEmployeePanel(me));
  }

  mount(container, ...nodes);
}

function renderEmployeePanel(me) {
  const list = el('div', { id: 'empList' }, el('p', { class: 'note' }, 'Loading roster…'));
  const panel = el('div.card', {}, [
    el('h3', {}, 'Employee Management'),
    el('p', { class: 'note' }, 'Everyone registered under ' + (me.business || 'your business') +
      '. Activate pending accounts to let them ring up sales.'),
    list,
  ]);

  async function refresh() {
    try {
      const res = await api.listEmployees();
      const rows = res.employees || [];
      if (!rows.length) { mount(list, el('p', { class: 'note' }, 'No one registered yet.')); return; }
      const items = rows.map((u) => {
        const who = u.character || u.email; // character name is the display identity
        const label = el('span', { html:
          '<b>' + esc(who) + '</b> · <span class="role-pill">' + esc(u.role) + '</span> · ' + statusBadge(u.status) });
        const row = el('div.emp-row', {}, [label]);
        if (u.status === 'pending') {
          const btn = el('button.primary.small', {
            onclick: async () => {
              btn.disabled = true;
              btn.textContent = 'Activating…';
              try { await api.activateEmployee(u.uid); await refresh(); }
              catch (e) { btn.disabled = false; btn.textContent = 'Activate'; alert(e.message || e); }
            },
          }, 'Activate');
          row.appendChild(btn);
        }
        return row;
      });
      mount(list, ...items);
    } catch (e) {
      mount(list, el('p', { class: 'error' }, e.message || String(e)));
    }
  }
  refresh();
  return panel;
}

function roleTitle(role) {
  return { admin: 'Administrator', owner: 'Shop Owner', employee: 'Employee' }[role] || 'Trader';
}
function statusBadge(status) {
  const cls = status === 'active' ? 'ok' : 'warn';
  return '<span class="' + cls + '">' + esc(status) + '</span>';
}
