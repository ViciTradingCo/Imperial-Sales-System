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
  // Register / Inventory / Employees live on an action bar: on Home for
  // owners/employees, and on the Business Operations page for admins.
  if (me.role === 'admin') items.push({ path: '/operations', label: 'Business Operations' });
  // The admin tools live in this menu (not as contextual buttons on the page).
  if (me.role === 'admin') {
    items.push({ path: '/admin/members', label: 'Member List' });
    items.push({ path: '/admin/companies', label: 'Company List' });
    items.push({ path: '/admin/items', label: 'Item Index' });
    items.push({ path: '/admin/market', label: 'Market Analysis' });
    items.push({ path: '/admin/motd', label: 'MOTD' });
    items.push({ path: '/admin/audit', label: 'Audit Log' });
    items.push({ path: '/admin/settings', label: 'Network Settings' });
  }
  // Court businesses get a report for their own hold.
  if (me.court && me.role !== 'admin') items.push({ path: '/hold-report', label: 'Hold Report' });
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
