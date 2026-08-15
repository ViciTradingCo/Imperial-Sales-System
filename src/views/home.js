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
import { regionWord, regionsOn, isTraveling } from '../lib/format.js';
import { el, mount, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { canManage } from '../lib/roles.js';
import { navigate } from '../lib/router.js';
import { tileGrid } from '../lib/tiles.js';
import { setAdminActions, subscriptionCard, recentErrorsPanel } from '../lib/sections.js';
import { skeletonLines } from '../lib/skeleton.js';

export function renderHome(container, { me }) {
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
    mount(container, motdHost, adminWelcomeCard(me), errorsCard(me));
    return; // an admin's tools are on the action bar, not on the page
  }

  mount(container,
    motdHost,
    el('div.card', {}, [
      el('h2', {}, 'Welcome, ' + (me.character || 'trader')),
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

  /**
   * Home's tiles NAVIGATE; they do not open focal menus.
   *
   * Every one of these has a page of its own, reachable from the shop-tools bar
   * as well. Opening the same view in a modal gave it two lives: the bar and the
   * side menu vanished behind the overlay, the browser's Back button closed
   * nothing, and the address bar still said Home — so there was no way to link
   * to what you were looking at, or return to it. A tile is a shortcut to a
   * page, and now it behaves like one.
   */
  function drawTiles() {
    const go = (path) => () => navigate(path);
    const tiles = [
      { key: 'register', label: 'Register', hint: 'Ring up a sale', glyph: '🪙', onOpen: go('/pos') },
      { key: 'inventory', label: 'Inventory', hint: 'Stock & intake', glyph: '📦', onOpen: go('/inventory') },
      // Clocking on is the first thing a member does and clocking off the last,
      // so it sits with the shop tools on the page everybody lands on. Not
      // gated: the card is the PERSON's, and the shop-wide log inside it is the
      // part that checks for a manager.
      { key: 'timecard', label: 'Time Card', hint: 'Clock in & out', glyph: '⏱️', onOpen: go('/timecard') },
      canManage(me) ? { key: 'employees', label: 'Employees', hint: 'Your roster', glyph: '🧑‍🤝‍🧑',
        onOpen: go('/employees') } : null,
      // Not gated: it holds the past sales and deliveries that every member
      // could always reach, and shows fewer sections to someone who is not
      // running the shop.
      { key: 'ledger', label: 'Shop Ledger', hint: 'Sales, deliveries, coffers', glyph: '📖',
        onOpen: go('/ledger') },
      // Shop Settings was reachable ONLY from the side menu — which on a phone
      // is behind the hamburger — while its sibling the Shop Ledger had a tile.
      // Half an owner's tools being one click from home and half being hidden is
      // most of why things here were reported as hard to find.
      canManage(me) ? { key: 'shopsettings', label: 'Shop Settings', hint: 'Discounts, style, exports', glyph: '⚙️',
        onOpen: go('/ledger/settings') } : null,
      canManage(me) ? { key: 'restock', label: 'Restock', hint: 'Low & out of stock', glyph: '🔔',
        onOpen: go('/restock') } : null,
      // Last week's trade in this shop's own region. Owner-level — it is what
      // the person setting prices needs, not the person ringing them up — and
      // hidden in realms that do not divide trade by region, where the page
      // would have nothing to report on.
      // A TRAVELLING shop is hidden for the same reason: it has no one market to
      // read. It trades wherever it happens to be, so a report on "its" region
      // would be a report on a place it may not have been all week.
      canManage(me) && regionsOn() && !isTraveling(me.hold)
        ? { key: 'marketinfo', label: 'Market Info', hint: 'Your ' + regionWord() + '’s market, last week', glyph: '📈',
            onOpen: go('/market-info') }
        : null,
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
    el('h2', {}, 'Welcome, ' + (me.character || me.email || 'administrator')),
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
function errorsCard(me) {
  const host = el('div', {}, skeletonLines(2));
  const card = el('div.card', {}, [el('h3', {}, 'Recent errors'), host]);
  card.hidden = true;
  const show = (errs) => mount(host, recentErrorsPanel(errs, me, show));
  api.getStatus().then((s) => {
    show(s.errors || []);
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
function roleTitle(me) {
  if (!me) return 'Trader';
  if (me.role === 'admin') return me.systemAdmin ? 'System Admin' : 'Realm Admin';
  return { owner: 'Shop Owner', employee: 'Employee' }[me.role] || 'Trader';
}
function statusBadge(status) {
  const cls = status === 'active' ? 'ok' : 'warn';
  return '<span class="' + cls + '">' + esc(status) + '</span>';
}
