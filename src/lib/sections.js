/**
 * Shared "section" action bars + the subscription panel.
 *
 * A section is a group of sibling pages that share one action bar — the
 * record-keeping screens (Member List / Company List / Item Index / Audit Log)
 * and Market Analysis's own sub-pages. Each page in a section sets the same
 * bar, so the buttons PERSIST as you move between siblings, and the current
 * page's button is marked active.
 *
 * A SHOP's pages have no bar. They had one — Register / Inventory / Shop Ledger
 * / Employees — and every entry on it was already a tile under Shop tools on
 * Home, which made the top of every shop screen a second copy of the landing
 * page. Home's tiles are the way to them now, and each of those pages carries a
 * Back link the way the admin screens always have.
 *
 * The two bars that remain are the ones with NO tile behind them: an admin has
 * no tile grid at all, and Market's sub-pages are sections of one screen rather
 * than destinations of their own.
 */
import { regionLabel, regionsOn, certificationOn } from './format.js';
import { el, mount, esc } from './dom.js';
import { navigate, currentPath } from './router.js';
import { setActions } from './actions.js';
import { toast } from './toast.js';
import { api } from './api.js';

/**
 * Marks the button whose `path` matches the current route as active.
 *
 * A SUB-PATH counts as its parent: `/pos/buy` is still the register, and
 * leaving Register unlit there made the bar look like it had lost its place.
 */
function mark(items) {
  const p = currentPath();
  const on = (path) => !!path && (path === p || p.startsWith(path + '/'));
  return items.map((it) => ({ ...it, class: on(it.path) ? 'active' : undefined }));
}

/**
 * The way off a shop page, now that those pages have no action bar.
 *
 * The same "← Back" the admin screens have always carried, written once
 * because seven pages need exactly it — a second wording of the same button
 * would be the drift this module exists to prevent. It goes to Home, since Home
 * is where the tile that opened the page lives.
 */
export function backToHome() {
  return el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back');
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
 * The recent-errors list, with a way to dismiss it.
 *
 * Shared by the Admin Panel and System Status so the two can't disagree about
 * what an error looks like or who may clear it. Without dismissal the panel only
 * ever said "something went wrong at some point"; with it, a non-empty list
 * means something is wrong NOW.
 *
 * The buffer is deployment-wide, so what "clear" means depends on the role: a
 * System Admin empties it, a Realm Admin drops only the entries stamped with
 * their own realm. The Worker decides that — this only words the button to
 * match, so nobody clicks expecting the other behaviour.
 */
export function recentErrorsPanel(errors, me, onCleared) {
  const errs = errors || [];
  const host = el('div', {});
  if (!errs.length) return el('div', {}, el('p', { class: 'note ok' }, 'No recent errors ✓'));

  const sys = !!(me && me.systemAdmin);
  const mine = errs.filter((e) => !e.realmId || !me || e.realmId === me.activeRealm);
  const clearable = sys ? errs.length : mine.length;
  // secondary-btn.small is the app's outline style for a non-destructive
  // action beside a heading; a bare <button> has no rule and renders unstyled.
  const btn = el('button.secondary-btn.small', { onclick: doClear },
    sys ? 'Dismiss all' : 'Dismiss this realm’s (' + clearable + ')');
  btn.disabled = !clearable;

  async function doClear() {
    btn.disabled = true;
    try {
      const r = await api.clearErrors();
      toast(r.cleared ? r.cleared + ' error(s) dismissed.' : 'Nothing to dismiss.', 'ok');
      if (onCleared) onCleared(r.errors || []);
    } catch (e) { btn.disabled = false; toast(e.message || String(e), 'error'); }
  }

  mount(host,
    el('div', { class: 'panel-head' }, [
      el('h4', {}, 'Recent errors (' + errs.length + ')'),
      btn,
    ]),
    ...errs.slice(0, 8).map((e) => el('p', { class: 'note error' },
      new Date(e.ts).toLocaleString() + ' · ' + e.where + ' — ' + e.message +
      // Which server it came from, when that isn't the one being viewed.
      (e.realmId && me && e.realmId !== me.activeRealm ? ' (realm ' + e.realmId + ')' : ''))));
  return host;
}

/**
 * A card showing the business's certification/subscription status and how long
 * it's good for. Returns the card immediately; fills it once /cert responds.
 */
export function subscriptionCard(me) {
  const host = el('div.card', {}, el('p', { class: 'note' }, 'Checking subscription…'));
  // A realm that does not require certification has no subscription to report,
  // and a card saying VALID over a date nobody maintains is worse than no card.
  if (!certificationOn()) { host.hidden = true; host.innerHTML = ''; return host; }
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
