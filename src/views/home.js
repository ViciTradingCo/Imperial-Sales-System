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
import { transferCard } from './realms.js';
import { navigate } from '../lib/router.js';

export function renderHome(container, { me, onProfileUpdated, onRealmChanged }) {
  // Filled by the realm picker; the Transfers module reads it for its
  // destination dropdowns, so both share one fetch.
  let adminRealms = [];
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

  const isAdmin = me.role === 'admin';
  const gridHost = el('div', {});
  const nodes = [motdHost];
  if (isAdmin) {
    // The Admin Panel is a landing page: a greeting, the realm this session is
    // filtered to, the tools as big buttons, then anything wrong.
    setAdminActions();
    nodes.push(
      adminWelcomeCard(me),
      realmPickerCard(me, onRealmChanged, (list) => { adminRealms = list; }),
      el('div.card', {}, [el('h3', {}, 'Network tools'), gridHost]),
      errorsCard());
  } else {
    nodes.push(idCard);
    nodes.push(el('div.card', {}, [el('h3', {}, 'Shop tools'), gridHost]));
    nodes.push(subscriptionCard(me));
  }
  mount(container, ...nodes);

  // Tiles render as soon as the page does; artwork fills in when it arrives.
  drawTiles({});
  api.getTiles().then((r) => drawTiles(r.images || {})).catch(() => { /* glyphs are fine */ });

  function open(title, render) {
    openFocalMenu(title, (host) => render(host));
  }

  /** The admin tools as big buttons — pages navigate, modules open in place. */
  function adminTiles() {
    return [
      { key: 'members', label: 'Members', hint: 'Everyone registered', glyph: '🧑‍🤝‍🧑',
        onOpen: () => navigate('/admin/members') },
      { key: 'companies', label: 'Companies', hint: 'Shops & certification', glyph: '🏛️',
        onOpen: () => navigate('/admin/companies') },
      { key: 'items', label: 'Item Index', hint: 'The master item library', glyph: '📜',
        onOpen: () => navigate('/admin/items') },
      { key: 'market', label: 'Market Analysis', hint: 'Network economy', glyph: '📈',
        onOpen: () => navigate('/admin/market') },
      { key: 'motd', label: 'MOTD', hint: 'Notices & banners', glyph: '📣',
        onOpen: () => navigate('/admin/motd') },
      { key: 'audit', label: 'Audit Log', hint: 'Who did what', glyph: '🔎',
        onOpen: () => navigate('/admin/audit') },
      // Moving someone between realms is usually noticed right here, so it opens
      // as a module rather than sending you to another page for one action.
      me.superAdmin ? { key: 'transfers', label: 'Transfers', hint: 'Move between realms', glyph: '🔀',
        onOpen: () => open('Move between realms', (h) => mount(h, transferCard(() => adminRealms))) } : null,
      { key: 'realms', label: 'Realm Management', hint: 'Servers & their settings', glyph: '🌐',
        onOpen: () => navigate('/admin/realms') },
      { key: 'settings', label: 'Network Settings', hint: 'Branding, holds, data', glyph: '⚙️',
        onOpen: () => navigate('/admin/settings') },
    ].filter(Boolean);
  }

  function drawTiles(images) {
    if (isAdmin) { mount(gridHost, tileGrid(adminTiles(), images)); return; }
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
 * Which realm this session is filtered to.
 *
 * This is the ONLY place a realm is chosen. The selection is stored on the
 * user's record server-side, so it holds for the rest of the session and every
 * other page — members, companies, inventory, sales, market, settings — reads
 * that realm and nothing else. Deliberately not repeated on other pages: an
 * accidental switch while working inside a realm is the expensive mistake here.
 *
 * Only a super admin can switch. A realm's own admin sees their realm named but
 * no buttons, because there is nothing for them to switch to. The Worker
 * re-checks either way.
 */
function realmPickerCard(me, onRealmChanged, onRealmsLoaded) {
  const host = el('div', {}, skeletonLines(1));
  const card = el('div.card', {}, [
    el('h3', {}, '🌐 Realm'),
    el('p', { class: 'note' }, 'Realms are separate servers with nothing shared between them. The one you pick ' +
      'here filters the whole app for the rest of your session.'),
    host,
  ]);

  api.getRealms().then((realmsResp) => {
    const realms = realmsResp.realms || [];
    if (onRealmsLoaded) onRealmsLoaded(realms);
    const current = realms.find((x) => x.id === me.activeRealm);
    const label = el('p', {}, [
      document.createTextNode('Showing '),
      el('b', {}, (current && current.name) || me.realmName || 'the main realm'),
      document.createTextNode(realms.length < 2 ? ' — the only realm on this deployment.' : '.'),
    ]);

    if (!me.superAdmin || realms.length < 2) { mount(host, label); return; }

    const status = el('p', {});
    const buttons = realms.map((r) => {
      const active = r.id === me.activeRealm;
      const b = el('button', {
        class: 'realm-pick' + (active ? ' is-active' : ''),
        onclick: () => choose(r, b),
      }, [
        el('span', { class: 'realm-pick-name' }, r.name),
        el('span', { class: 'realm-pick-meta' },
          active ? 'Showing now' : r.companies + ' shops · ' + r.members + ' members'),
      ]);
      return b;
    });

    async function choose(r, btn) {
      if (r.id === me.activeRealm) return;
      buttons.forEach((b) => { b.disabled = true; });
      status.className = ''; status.textContent = 'Switching to ' + r.name + '…';
      try {
        await api.selectRealm(r.id);
        toast('Now showing ' + r.name, 'ok');
        if (onRealmChanged) await onRealmChanged();
      } catch (e) {
        status.className = 'error'; status.textContent = e.message || String(e);
        buttons.forEach((b) => { b.disabled = false; });
      }
    }

    mount(host, label, el('div', { class: 'realm-picker' }, buttons), status);
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
