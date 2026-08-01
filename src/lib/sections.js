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
 * The admin-tools action set (Member List / Company List / … / Realms).
 *
 * Every one of these pages shows a single realm's data, so the bar ends with
 * the realms themselves: one button per realm, the current one marked, clicking
 * switches. `me` is optional — without it the realm buttons are simply omitted,
 * which keeps older call sites working.
 */
export function setAdminActions(me) {
  const items = [
    { label: 'Member List', path: '/admin/members', onClick: () => navigate('/admin/members') },
    { label: 'Company List', path: '/admin/companies', onClick: () => navigate('/admin/companies') },
    { label: 'Item Index', path: '/admin/items', onClick: () => navigate('/admin/items') },
    { label: 'MOTD', path: '/admin/motd', onClick: () => navigate('/admin/motd') },
    { label: 'Audit Log', path: '/admin/audit', onClick: () => navigate('/admin/audit') },
    { label: 'Network Settings', path: '/admin/settings', onClick: () => navigate('/admin/settings') },
    { label: 'Realms', path: '/admin/realms', onClick: () => navigate('/admin/realms') },
  ];
  setActions(mark(items));
  if (me) appendRealmButtons(items, me);
}

/**
 * Appends one button per realm to the admin bar, so switching servers is always
 * one click from any admin page. Loaded after the bar is drawn so the bar never
 * waits on the network; a single realm adds nothing (there is nothing to pick).
 */
async function appendRealmButtons(baseItems, me) {
  if (!me.superAdmin) return;
  let realms;
  try { realms = (await api.getRealms()).realms || []; } catch (e) { return; }
  if (realms.length < 2) return;
  const realmItems = realms.map((r) => ({
    label: (r.id === me.activeRealm ? '● ' : '○ ') + r.name,
    class: r.id === me.activeRealm ? 'active' : undefined,
    onClick: async () => {
      if (r.id === me.activeRealm) return;
      try {
        await api.selectRealm(r.id);
        // A realm change invalidates every page, so reload rather than trying
        // to re-render whatever happens to be open.
        window.location.reload();
      } catch (e) { /* the API reports the reason on the page that triggered it */ }
    },
  }));
  setActions([...mark(baseItems), { separator: true }, ...realmItems]);
}

/** Market Analysis sub-page bar (Overview / Item / Hold / Company performance). */
export function setMarketActions() {
  setActions(mark([
    { label: 'Overview', path: '/admin/market', onClick: () => navigate('/admin/market') },
    { label: 'Item Performance', path: '/admin/market/items', onClick: () => navigate('/admin/market/items') },
    { label: 'Hold Performance', path: '/admin/market/holds', onClick: () => navigate('/admin/market/holds') },
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
