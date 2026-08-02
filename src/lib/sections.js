/**
 * Shared "section" action bars + the subscription panel.
 *
 * A section is a group of sibling pages that share one action bar (e.g. the
 * business tools: Register / Inventory / Employees, or the admin tools: Member
 * List / Company List / …). Each page in a section sets the same bar, so the
 * buttons PERSIST as you move between sibling sub-pages, and the current page's
 * button is marked active.
 */
import { regionLabel, regionsOn } from './format.js';
import { el, mount, esc } from './dom.js';
import { navigate, currentPath } from './router.js';
import { setActions } from './actions.js';
import { api } from './api.js';

/** Marks the button whose `path` matches the current route as active. */
function mark(items) {
  const p = currentPath();
  return items.map((it) => ({ ...it, class: it.path && it.path === p ? 'active' : undefined }));
}

/** The business-tools action set (Register / Inventory / Employees). */
export function setOpsActions(me) {
  const items = [
    { label: 'Register', path: '/pos', onClick: () => navigate('/pos') },
    { label: 'Inventory', path: '/inventory', onClick: () => navigate('/inventory') },
  ];
  if (me.role === 'owner' || me.role === 'admin') {
    items.push({ label: 'Employees', path: '/employees', onClick: () => navigate('/employees') });
  }
  setActions(mark(items));
}

/**
 * The signed-in user, remembered so the admin bar is identical on every admin
 * page. This used to be a parameter, which meant six call sites each had to
 * remember to pass it — and the ones that forgot rendered a bar with entries
 * missing. main.js sets this once at sign-in and again after a realm switch.
 */
let sessionUser = null;
export function setSessionUser(me) { sessionUser = me || null; }

/**
 * The record-keeping screens — members, companies, items, audit — which are
 * siblings you move between while doing one job, so they share a bar.
 *
 * Market Analysis, MOTD and Realm Management are NOT here: each owns a whole
 * screen (and Market brings its own sub-bar), so they live in the side menu.
 */
export function setAdminActions() {
  setActions(mark([
    { label: 'Member List', path: '/admin/members', onClick: () => navigate('/admin/members') },
    { label: 'Company List', path: '/admin/companies', onClick: () => navigate('/admin/companies') },
    { label: 'Item Index', path: '/admin/items', onClick: () => navigate('/admin/items') },
    { label: 'Audit Log', path: '/admin/audit', onClick: () => navigate('/admin/audit') },
  ]));
}

/**
 * Market Analysis sub-pages, on the header bar.
 *
 * Replacing the admin bar is fine here because Market Analysis is reached from
 * the SIDE menu, which stays put — so the way back is always visible. (When
 * Market lived on the bar itself, clicking it swapped the menu out and stranded
 * you; that is why the two live in different menus.)
 */
export function setMarketActions() {
  setActions(mark([
    { label: 'Overview', path: '/admin/market', onClick: () => navigate('/admin/market') },
    { label: 'Item Performance', path: '/admin/market/items', onClick: () => navigate('/admin/market/items') },
    // Omitted when the realm doesn't use regions — the page would be empty.
    ...(regionsOn() ? [{ label: regionLabel() + ' Performance', path: '/admin/market/regions', onClick: () => navigate('/admin/market/regions') }] : []),
    { label: 'Company Performance', path: '/admin/market/companies', onClick: () => navigate('/admin/market/companies') },
    { label: 'Trends', path: '/admin/market/trends', onClick: () => navigate('/admin/market/trends') },
  ]));
}

/**
 * A card showing the business's certification/subscription status and how long
 * it's good for. Returns the card immediately; fills it once /cert responds.
 */
export function subscriptionCard(me) {
  const host = el('div.card', {}, el('p', { class: 'note' }, 'Checking subscription…'));
  api.getCert()
    .then((c) => {
      const status = String(c.status || '').toUpperCase();
      const cls = status === 'VALID' ? 'ok' : 'bad';
      const detail = c.perpetual
        ? 'Perpetual — this subscription never expires.'
        : (c.until ? 'Good until ' + c.until + '.' : 'No active subscription on file.');
      mount(host,
        el('h3', {}, 'Subscription'),
        el('p', { html: '<b>' + esc(me.business || 'Your shop') + '</b> · ' +
          '<span class="' + cls + '">' + esc(status || '—') + '</span>' }),
        el('p', { class: 'note' }, detail));
    })
    .catch((err) => mount(host,
      el('h3', {}, 'Subscription'),
      el('p', { class: 'error' }, err.message || String(err))));
  return host;
}
