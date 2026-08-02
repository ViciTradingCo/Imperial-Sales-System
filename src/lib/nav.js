/**
 * Sidebar / drawer navigation. One list of role-scoped destinations, rendered
 * as buttons into the sidenav (a fixed side panel on desktop, an off-canvas
 * left drawer on mobile). Access is still enforced by the API and the route
 * guards — this only decides which buttons to show.
 */
import { navigate, currentPath } from './router.js';

/** The nav destinations available to a given user, in order. */
export function navItems(me) {
  const items = [{ path: '/', label: me.role === 'admin' ? 'Admin Panel' : 'Home' }];
  // Register / Inventory / Employees live on an action bar on Home for
  // owners/employees. Admins manage the network, not a shop, so they don't get
  // the Business Operations entry.
  // The admin destinations split by how they're used. These three are places
  // you GO — each owns its own screen and its own sub-navigation — so they sit
  // in the side menu. The record-keeping screens (members, companies, items,
  // audit) share one action bar instead; see setAdminActions.
  if (me.role === 'admin') {
    items.push({ path: '/admin/market', label: 'Market Analysis' });
    items.push({ path: '/admin/motd', label: 'MOTD' });
    // Realm Management also holds Network Settings, so it is always reachable —
    // not gated on realm count the way the realm-specific controls inside it are.
    items.push({ path: '/admin/realms', label: 'Realm Management' });
  }
  // Court businesses get a report for their own hold.
  if (me.court && me.role !== 'admin') items.push({ path: '/hold-report', label: 'Region Report' });
  if (me.role === 'owner') items.push({ path: '/ledger/settings', label: 'Ledger Settings' });
  items.push({ path: '/profile', label: 'Profile' });
  items.push({ path: '/patch-notes', label: 'Patch Notes' });
  items.push({ path: '/about', label: 'About' });
  return items;
}

/** Renders the nav buttons into `navEl`. `onNavigate` runs after each click.
 *  `onSignOut`, when given, adds a Sign Out entry (shown only in the mobile
 *  drawer — desktop has sign-out by the nameplate). */
export function renderNav(navEl, me, onNavigate, onSignOut) {
  navEl.innerHTML = '';
  navItems(me).forEach((it) => {
    const b = document.createElement('button');
    b.textContent = it.label;
    b.dataset.path = it.path;
    b.addEventListener('click', () => {
      navigate(it.path);
      if (onNavigate) onNavigate();
    });
    navEl.appendChild(b);
  });
  if (onSignOut) {
    const out = document.createElement('button');
    out.className = 'nav-signout';
    out.textContent = 'Sign Out';
    out.addEventListener('click', onSignOut);
    navEl.appendChild(out);
  }
  highlightNav(navEl);
}

/** Marks the button matching the current route as active. */
export function highlightNav(navEl) {
  const path = currentPath();
  navEl.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.dataset.path === path);
  });
}
