/**
 * Home — the signed-in landing.
 *
 * Owners and employees get their shop tools as a grid of big square tiles, each
 * opening its section in a focal menu rather than stacking cards down the page.
 *
 * Admins get a plain landing card and nothing else: their tools all live on the
 * admin action bar (see setAdminActions). The panel used to repeat those same
 * destinations as tiles, which meant two lists of the same links to keep in step
 * and two places to look for one thing.
 *
 * Tile artwork is assigned by an admin (Network Settings → Tile Images) as image
 * URLs; tiles fall back to a glyph when no image is set.
 */
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { tileGrid, openFocalMenu } from '../lib/tiles.js';
import { setAdminActions, subscriptionCard } from '../lib/sections.js';
import { renderPos } from './pos.js';
import { renderInventory } from './inventory.js';
import { renderEmployees } from './employees.js';
import { renderLedgerSettings } from './ledger-settings.js';
import { openLowStockModal } from './low-stock.js';
import { skeletonLines } from '../lib/skeleton.js';

export function renderHome(container, { me, onProfileUpdated }) {
  // Notices — the global MOTD plus any active per-business messages.
  const motdHost = el('div', {});
  api.getMotd().then((r) => {
    const notices = (r && r.notices) || [];
    if (notices.length) mount(motdHost, ...notices.map((n) =>
      el('div', { class: 'card motd-card' }, [el('h3', {}, '📜 Notice'), el('p', {}, n)])));
  }).catch(() => { /* banners are non-critical */ });

  const isAdmin = me.role === 'admin';
  const gridHost = el('div', {});
  // Tile artwork, kept so a later redraw doesn't drop images that already loaded.
  let tileImages = {};

  if (isAdmin) {
    setAdminActions();
    mount(container, motdHost, adminWelcomeCard(me), errorsCard());
    return; // an admin's tools are on the action bar, not on the page
  }

  mount(container,
    motdHost,
    el('div.card', {}, [
      el('h2', {}, 'Welcome, ' + esc(me.character || 'trader')),
      el('p', { html:
        '<b>Business:</b> ' + esc(me.business || '—') + '<br>' +
        '<b>Role:</b> ' + esc(roleTitle(me)) + '<br>' +
        '<b>Status:</b> ' + statusBadge(me.status) }),
      me.status === 'pending'
        ? el('p', { class: 'warn', html:
            'Your account is <b>pending</b> — an owner or admin must activate it before you can ring up sales.' })
        : el('p', { class: 'ok' }, 'Your account is active.'),
    ]),
    el('div.card', {}, [el('h3', {}, 'Shop tools'), gridHost]),
    subscriptionCard(me));

  // Tiles render as soon as the page does; artwork fills in when it arrives.
  drawTiles();
  api.getTiles().then((r) => { tileImages = r.images || {}; drawTiles(); }).catch(() => { /* glyphs are fine */ });

  function open(title, render) {
    openFocalMenu(title, (host) => render(host));
  }

  function drawTiles() {
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
    mount(gridHost, tileGrid(tiles.filter(Boolean), tileImages));
  }
}

/**
 * The Admin Panel greeting. Says nothing about realms on a single-realm
 * deployment — the default, and what most people will ever run — so the panel
 * looks exactly as it did before multi-realm existed.
 */
function adminWelcomeCard(me) {
  const nodes = [
    el('h2', {}, 'Welcome, ' + esc(me.character || me.email || 'administrator')),
    el('p', { html: 'This is the Admin Panel — you are signed in as a <b>' + esc(roleTitle(me)) + '</b>. ' +
      'Your tools are on the bar above.' }),
  ];
  if (!me.systemAdmin) {
    nodes.push(el('p', { class: 'note' }, 'As a Realm Admin your tools cover this realm only — its members, ' +
      'shops, items, and settings. Other realms are not visible to you.'));
  }
  if (Number(me.realmCount) > 1) {
    nodes.push(el('p', { class: 'note', html:
      'You are viewing <b>' + esc(me.realmName || me.activeRealm || 'the main realm') + '</b>. Every page shows ' +
      'that realm and nothing else — switch realms from Realm Management.' }));
  }
  return el('div.card', {}, nodes);
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
      new Date(e.ts).toLocaleString() + ' · ' + e.where + ' — ' + e.message +
      (e.realmId ? ' (realm ' + e.realmId + ')' : ''))));
    card.hidden = false;
  }).catch(() => { /* status is admin-only and non-critical here */ });
  return card;
}

/**
 * What to call this account. 'admin' covers two very different jobs: a System
 * Admin runs the deployment and can cross realms, a Realm Admin administers one
 * realm and cannot. The distinction comes from the server (me.systemAdmin), not
 * from the stored role.
 */
export function roleTitle(me) {
  if (!me) return 'Trader';
  if (me.role === 'admin') return me.systemAdmin ? 'System Admin' : 'Realm Admin';
  return { owner: 'Shop Owner', employee: 'Employee' }[me.role] || 'Trader';
}
function statusBadge(status) {
  const cls = status === 'active' ? 'ok' : 'warn';
  return '<span class="' + cls + '">' + esc(status) + '</span>';
}
