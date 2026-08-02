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
import { navigate } from '../lib/router.js';

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
      '<b>Role:</b> ' + esc(roleTitle(me)) + '<br>' +
      '<b>Status:</b> ' + statusBadge(me.status) }),
    me.status === 'pending'
      ? el('p', { class: 'warn', html:
          'Your account is <b>pending</b> — an owner or admin must activate it before you can ring up sales.' })
      : el('p', { class: 'ok' }, 'Your account is active.'),
  ]);

  const isAdmin = me.role === 'admin';
  const gridHost = el('div', {});
  const welcomeHost = el('div', {});
  const realmHost = el('div', {});
  const nodes = [motdHost];
  // Tile artwork, kept so a later redraw doesn't drop images that already loaded.
  let tileImages = {};
  const realmCount = Number(me.realmCount) || 1;
  if (isAdmin) {
    // The Admin Panel is a landing page: a greeting, the tools as big buttons,
    // then anything wrong. Realm content is added afterwards, and only if this
    // deployment actually has more than one realm.
    setAdminActions();
    mount(welcomeHost, adminWelcomeCard(me, realmCount));
    nodes.push(
      welcomeHost,
      realmHost,
      el('div.card', {}, [el('h3', {}, 'Network tools'), gridHost]),
      errorsCard());
  } else {
    nodes.push(idCard);
    nodes.push(el('div.card', {}, [el('h3', {}, 'Shop tools'), gridHost]));
    nodes.push(subscriptionCard(me));
  }
  mount(container, ...nodes);

  // Tiles render as soon as the page does; artwork fills in when it arrives.
  drawTiles();
  api.getTiles().then((r) => { tileImages = r.images || {}; drawTiles(); }).catch(() => { /* glyphs are fine */ });

  // Realms are a dormant feature until a second one exists. /auth/me already
  // told us how many there are, so a single-realm deployment costs no extra
  // request and nothing rendered above changes.
  if (isAdmin && realmCount > 1) {
    mount(welcomeHost, adminWelcomeCard(me, realmCount));
    drawTiles(); // the Realm Management tile belongs on the grid now
    api.getRealms().then((r) => {
      const picker = realmPickerCard(me, r.realms || [], onRealmChanged);
      if (picker) mount(realmHost, picker);
    }).catch(() => { /* the picker is optional; the nav still reaches Realms */ });
  }

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
      // Realms stay out of sight until this deployment actually runs more than
      // one. Reaching the first one is done from Network Settings.
      realmCount > 1 ? { key: 'realms', label: 'Realm Management', hint: 'Servers & their settings', glyph: '🌐',
        onOpen: () => navigate('/admin/realms') } : null,
      { key: 'settings', label: 'Network Settings', hint: 'Branding, holds, data', glyph: '⚙️',
        onOpen: () => navigate('/admin/settings') },
    ].filter(Boolean);
  }

  function drawTiles() {
    const images = tileImages;
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

/**
 * The Admin Panel greeting — the standard landing card, same shape as everyone
 * else's. Deliberately says nothing about realms: a single-realm deployment (the
 * default, and what most people will ever run) should look exactly as it did
 * before multi-realm existed. The realm line appears only once a second realm
 * is actually created.
 */
function adminWelcomeCard(me, realmCount) {
  const nodes = [
    el('h2', {}, 'Welcome, ' + esc(me.character || me.email || 'administrator')),
    el('p', { html: 'This is the Admin Panel — you are signed in as a <b>' + esc(roleTitle(me)) + '</b>. ' +
      'Pick a tool below, or use the menu above to move between them.' }),
  ];
  if (me.role === 'admin' && !me.systemAdmin) {
    nodes.push(el('p', { class: 'note' }, 'As a Realm Admin your tools cover this realm only — its members, ' +
      'shops, items, and settings. Other realms are not visible to you.'));
  }
  if (realmCount > 1) {
    nodes.push(el('p', { class: 'note', html:
      'You are viewing <b>' + esc(me.realmName || me.activeRealm || 'the main realm') + '</b>. ' +
      'Every page shows that realm and nothing else.' }));
  }
  return el('div.card', {}, nodes);
}

/**
 * Which realm this session is filtered to — rendered ONLY when more than one
 * realm exists. With a single realm there is nothing to choose and no reason to
 * mention realms at all, so the panel stays as it was before the feature.
 *
 * This is the one place a realm is chosen. The selection is stored server-side
 * on the user's record, so it holds for the rest of the session and every other
 * page reads that realm. Deliberately not repeated elsewhere: switching realm by
 * reflex while working inside one is the expensive mistake here.
 *
 * Only a super admin can switch; the Worker re-checks that regardless.
 */
function realmPickerCard(me, realms, onRealmChanged) {
  if (realms.length < 2 || !me.systemAdmin) return null;

  const status = el('p', {});
  const buttons = realms.map((r) => {
    const active = r.id === me.activeRealm;
    const b = el('button', {
      class: 'realm-pick' + (active ? ' is-active' : ''),
      onclick: () => choose(r),
    }, [
      el('span', { class: 'realm-pick-name' }, r.name),
      el('span', { class: 'realm-pick-meta' },
        active ? 'Showing now' : r.companies + ' shops · ' + r.members + ' members'),
    ]);
    return b;
  });

  async function choose(r) {
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

  return el('div.card', {}, [
    el('h3', {}, '🌐 Realm'),
    el('p', { class: 'note' }, 'Realms are separate servers with nothing shared between them. The one you pick ' +
      'here filters the whole app for the rest of your session.'),
    el('div', { class: 'realm-picker' }, buttons),
    status,
  ]);
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
