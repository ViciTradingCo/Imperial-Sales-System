/**
 * Home — the signed-in landing, built as a grid of big square tiles. Each tile
 * opens its section in a focal menu (modal) rather than stacking cards down the
 * page. Admins see the network tools; owners/employees see their shop tools.
 *
 * Tile artwork is assigned by an admin (Network Settings → Tile Images) as image
 * URLs; tiles fall back to a glyph when no image is set.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { tileGrid, openFocalMenu } from '../lib/tiles.js';
import { setAdminActions, subscriptionCard } from '../lib/sections.js';
import { toast } from '../lib/toast.js';
import { renderPos } from './pos.js';
import { renderInventory } from './inventory.js';
import { renderEmployees } from './employees.js';
import { renderLedgerSettings } from './ledger-settings.js';
import { openLowStockModal } from './low-stock.js';
import { skeletonLines } from '../lib/skeleton.js';

export function renderHome(container, { me, onProfileUpdated, onRealmChanged }) {
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

  // Admins get the network tools on the header action bar (as before the tile
  // change). Owners/employees keep the big-button shop tools on the page.
  const isAdmin = me.role === 'admin';
  const gridHost = el('div', {});
  const nodes = [motdHost];
  if (isAdmin) {
    // The Admin Panel is a landing page: a greeting that says plainly which
    // realm is being shown, then the realm picker, then anything wrong.
    setAdminActions(me);
    nodes.push(adminWelcomeCard(me), realmPickerCard(me, onRealmChanged), errorsCard());
  } else {
    nodes.push(idCard);
    nodes.push(el('div.card', {}, [el('h3', {}, 'Shop tools'), gridHost]));
    nodes.push(subscriptionCard(me));
  }
  mount(container, ...nodes);

  if (isAdmin) return; // nothing else to draw
  // Tiles render as soon as the page does; artwork fills in when it arrives.
  drawTiles({});
  api.getTiles().then((r) => drawTiles(r.images || {})).catch(() => { /* glyphs are fine */ });

  function open(title, render) {
    openFocalMenu(title, (host) => render(host));
  }

  function drawTiles(images) {
    const tiles = [
      { key: 'register', label: 'Register', hint: 'Ring up a sale', glyph: '🪙',
        onOpen: () => open('Register', (h) => renderPos(h, { me })) },
      { key: 'inventory', label: 'Inventory', hint: 'Stock & intake', glyph: '📦',
        onOpen: () => open('Inventory', (h) => renderInventory(h, { me })) },
      me.role === 'owner' ? { key: 'employees', label: 'Employees', hint: 'Your roster', glyph: '🧑‍🤝‍🧑',
        onOpen: () => open('Employees', (h) => renderEmployees(h, { me })) } : null,
      me.role === 'owner' ? { key: 'ledger', label: 'Shop Ledger', hint: 'Coffers, discounts, style', glyph: '📖',
        onOpen: () => open('Shop Ledger', (h) => renderLedgerSettings(h, { me, onBusinessRenamed: onProfileUpdated || (() => {}) })) } : null,
      me.role === 'owner' ? { key: 'restock', label: 'Restock', hint: 'Low & out of stock', glyph: '🔔',
        onOpen: () => openLowStockModal() } : null,
    ];
    mount(gridHost, tileGrid(tiles.filter(Boolean), images));
  }
}

/** The Admin Panel greeting — who you are, and which realm you are looking at. */
function adminWelcomeCard(me) {
  return el('div.card', {}, [
    el('h2', {}, 'Welcome, ' + esc(me.character || me.email || 'administrator')),
    el('p', {}, 'This is the Admin Panel — the controls for the whole network. The tools are on the bar above: ' +
      'members, companies, the item index, notices, the audit log, and settings.'),
    el('p', { class: 'note', html:
      'You are viewing <b>' + esc(me.realmName || me.activeRealm || 'the main realm') + '</b>. ' +
      'Every page in the app shows that realm and nothing else.' }),
  ]);
}

/**
 * Which realm the app displays. Only a super admin can switch; a realm's own
 * admin sees their realm named here but no picker, because there is nothing for
 * them to switch to. The Worker re-checks this either way.
 */
function realmPickerCard(me, onRealmChanged) {
  const host = el('div', {}, skeletonLines(1));
  const card = el('div.card', {}, [
    el('h3', {}, '🌐 Realm'),
    el('p', { class: 'note' }, 'Realms are separate servers. Switching changes what every other page shows — ' +
      'members, companies, inventory, sales, market analysis, and settings all follow the realm you pick.'),
    host,
  ]);

  api.getRealms().then((r) => {
    const realms = r.realms || [];
    if (!me.superAdmin || realms.length < 2) {
      mount(host, el('p', {}, [
        document.createTextNode('Showing '),
        el('b', {}, me.realmName || me.activeRealm || 'the main realm'),
        document.createTextNode(realms.length < 2 ? ' — the only realm on this deployment.' : '.'),
      ]));
      return;
    }
    const sel = el('select', {});
    realms.forEach((x) => {
      const o = el('option', { value: x.id }, x.name + ' (' + x.companies + ' shops, ' + x.members + ' members)');
      if (x.id === me.activeRealm) o.selected = true;
      sel.appendChild(o);
    });
    const status = el('p', {});
    const apply = el('button.primary', { onclick: async () => {
      if (sel.value === me.activeRealm) { status.className = ''; status.textContent = 'Already showing that realm.'; return; }
      apply.disabled = true; status.className = ''; status.textContent = 'Switching…';
      try {
        await api.selectRealm(sel.value);
        toast('Now showing ' + sel.options[sel.selectedIndex].textContent.replace(/ \(.*$/, ''), 'ok');
        if (onRealmChanged) await onRealmChanged();
      } catch (e) { status.className = 'error'; status.textContent = e.message || String(e); }
      finally { apply.disabled = false; }
    } }, 'Show this realm');
    mount(host,
      el('label', {}, 'Display data for'), sel,
      el('div', { class: 'row-actions' }, [apply]),
      status);
  }).catch((e) => mount(host, el('p', { class: 'error' }, e.message || String(e))));

  return card;
}

/**
 * Admin Panel: recent internal errors only. Silent when everything is healthy,
 * so the page stays quiet unless it has something worth saying.
 */
function errorsCard() {
  const host = el('div', {}, skeletonLines(2));
  const card = el('div.card', {}, [el('h3', {}, 'Recent errors'), host]);
  card.hidden = true;
  api.getStatus().then((s) => {
    const errs = s.errors || [];
    if (!errs.length) {
      mount(host, el('p', { class: 'note ok' }, 'No recent errors ✓'));
      card.hidden = false;
      return;
    }
    mount(host, ...errs.slice(0, 6).map((e) => el('p', { class: 'note error' },
      new Date(e.ts).toLocaleString() + ' · ' + e.where + ' — ' + e.message)));
    card.hidden = false;
  }).catch(() => { /* status is admin-only and non-critical here */ });
  return card;
}

function roleTitle(role) {
  return { admin: 'Administrator', owner: 'Shop Owner', employee: 'Employee' }[role] || 'Trader';
}
function statusBadge(status) {
  const cls = status === 'active' ? 'ok' : 'warn';
  return '<span class="' + cls + '">' + esc(status) + '</span>';
}
