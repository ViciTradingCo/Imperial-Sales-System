/**
 * Shared "section" action bars + the subscription panel.
 *
 * A section is a group of sibling pages that share one action bar (e.g. the
 * business tools: Register / Inventory / Employees, or the admin tools: Member
 * List / Company List / …). Each page in a section sets the same bar, so the
 * buttons PERSIST as you move between sibling sub-pages, and the current page's
 * button is marked active.
 */
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
 * The admin tools — ONE bar holding every admin destination.
 *
 * Deliberately the only place they appear. The Admin Panel used to repeat the
 * same destinations as tiles and the side nav carried two more, which meant
 * three lists of the same links to keep in step and three places to look.
 *
 * No realm switcher here either: choosing a realm happens on Realm Management
 * and filters the session from there. A switch sitting on every admin page
 * invites changing realm by reflex while working inside another one.
 */
export function setAdminActions() {
  const me = sessionUser;
  const items = [
    { label: 'Member List', path: '/admin/members', onClick: () => navigate('/admin/members') },
    { label: 'Company List', path: '/admin/companies', onClick: () => navigate('/admin/companies') },
    { label: 'Item Index', path: '/admin/items', onClick: () => navigate('/admin/items') },
    { label: 'Market Analysis', path: '/admin/market', onClick: () => navigate('/admin/market') },
    { label: 'MOTD', path: '/admin/motd', onClick: () => navigate('/admin/motd') },
    { label: 'Audit Log', path: '/admin/audit', onClick: () => navigate('/admin/audit') },
    { label: 'Network Settings', path: '/admin/settings', onClick: () => navigate('/admin/settings') },
  ];
  // Realms stay hidden until this deployment actually runs more than one; the
  // way in before that is Network Settings → Realms.
  if (me && Number(me.realmCount) > 1) {
    items.push({ label: 'Realm Management', path: '/admin/realms', onClick: () => navigate('/admin/realms') });
  }
  setActions(mark(items));
}

/**
 * Market Analysis sub-tabs, rendered IN the page rather than on the action bar.
 *
 * They used to replace the admin bar, which meant clicking "Market Analysis"
 * swapped the whole menu out and left no way back to the other admin pages. The
 * bar is the app's one fixed menu; a page's own sections belong to the page.
 */
export function marketTabs() {
  const tabs = [
    ['Overview', '/admin/market'],
    ['Item Performance', '/admin/market/items'],
    ['Hold Performance', '/admin/market/holds'],
    ['Company Performance', '/admin/market/companies'],
    ['Trends', '/admin/market/trends'],
  ];
  const here = currentPath();
  return el('div', { class: 'tab-row' }, tabs.map(([label, path]) =>
    el('button', {
      class: 'tab-btn' + (path === here ? ' is-active' : ''),
      onclick: () => navigate(path),
    }, label)));
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
