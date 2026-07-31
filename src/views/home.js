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
import { subscriptionCard } from '../lib/sections.js';
import { renderMembers } from './members.js';
import { renderCompanies } from './companies.js';
import { renderItemIndex } from './item-index.js';
import { renderMotdAdmin } from './motd-admin.js';
import { renderAudit } from './audit.js';
import { renderAdminSettings } from './admin-settings.js';
import { renderMarket } from './market.js';
import { renderPos } from './pos.js';
import { renderInventory } from './inventory.js';
import { renderEmployees } from './employees.js';
import { renderLedgerSettings } from './ledger-settings.js';
import { openLowStockModal } from './low-stock.js';

export function renderHome(container, { me, onProfileUpdated }) {
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

  const gridHost = el('div', {});
  const nodes = [motdHost, idCard, el('div.card', {}, [
    el('h3', {}, me.role === 'admin' ? 'Network tools' : 'Shop tools'),
    gridHost,
  ])];
  if (me.role !== 'admin') nodes.push(subscriptionCard(me));
  mount(container, ...nodes);

  // Tiles render as soon as the page does; artwork fills in when it arrives.
  drawTiles({});
  api.getTiles().then((r) => drawTiles(r.images || {})).catch(() => { /* glyphs are fine */ });

  function open(title, render) {
    openFocalMenu(title, (host) => render(host));
  }

  function drawTiles(images) {
    const tiles = me.role === 'admin' ? [
      { key: 'members', label: 'Members', hint: 'People in the network', glyph: '👥',
        onOpen: () => open('Member List', (h) => renderMembers(h)) },
      { key: 'companies', label: 'Companies', hint: 'Shops & certification', glyph: '🏛️',
        onOpen: () => open('Company List', (h) => renderCompanies(h)) },
      { key: 'items', label: 'Item Index', hint: 'Canonical items', glyph: '📜',
        onOpen: () => open('Master Item Index', (h) => renderItemIndex(h)) },
      { key: 'market', label: 'Market', hint: 'Network analytics', glyph: '📈',
        onOpen: () => open('Market Analysis', (h) => renderMarket(h)) },
      { key: 'motd', label: 'MOTD', hint: 'Notices & banners', glyph: '📣',
        onOpen: () => open('Message of the Day', (h) => renderMotdAdmin(h)) },
      { key: 'audit', label: 'Audit Log', hint: 'What changed', glyph: '🧾',
        onOpen: () => open('Audit Log', (h) => renderAudit(h)) },
      { key: 'settings', label: 'Settings', hint: 'Network, backup, reset', glyph: '⚙️',
        onOpen: () => open('Network Settings', (h) => renderAdminSettings(h)) },
    ] : [
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

function roleTitle(role) {
  return { admin: 'Administrator', owner: 'Shop Owner', employee: 'Employee' }[role] || 'Trader';
}
function statusBadge(status) {
  const cls = status === 'active' ? 'ok' : 'warn';
  return '<span class="' + cls + '">' + esc(status) + '</span>';
}
