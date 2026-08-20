/**
 * App bootstrap + shell: navigation (sidebar / mobile drawer), routing, and the
 * signed-out landing. Each panel is its own route/page, selected from the nav.
 */
import { loadConfig } from './lib/config.js';
import { initAuth, renderSignInButton, onAuthChange, getProfile, signOut } from './lib/auth.js';
import { configureApi, api } from './lib/api.js';
import { initRouter, route, navigate, render, onBeforeRender } from './lib/router.js';
import { canManage } from './lib/roles.js';
import { el, mount } from './lib/dom.js';
import { renderNav, highlightNav } from './lib/nav.js';
import { applyPrefs } from './lib/theme.js';
import { applyLang } from './lib/i18n.js';
import { loadBranding, applyBranding } from './lib/branding.js';
import { renderPatchNotes } from './lib/patch-notes.js';
import { renderCourtTools } from './views/court.js';
import { renderFeedback } from './views/feedback.js';
import { renderFeedbackAdmin } from './views/feedback-admin.js';
import { initActions, clearActions } from './lib/actions.js';
import { setCurrency, setRegion, setItemTags, setCertification } from './lib/format.js';
import { setSessionUser } from './lib/sections.js';
import { renderLanding } from './views/landing.js';
import { renderHome } from './views/home.js';
import { openLowStockModal, renderLowStock } from './views/low-stock.js';
import { renderRegister } from './views/register.js';
import { renderProfile } from './views/profile.js';
import { renderEmployees } from './views/employees.js';
import { renderInventory } from './views/inventory.js';
import { renderPos } from './views/pos.js';
import { renderAdminSettings } from './views/admin-settings.js';
import { renderRealms } from './views/realms.js';
import { renderMembers } from './views/members.js';
import { renderCompanies } from './views/companies.js';
import { renderMarket } from './views/market.js';
import { renderMotdAdmin } from './views/motd-admin.js';
import { renderAudit } from './views/audit.js';
import { renderItemIndex } from './views/item-index.js';
import { renderLedgerSettings, renderShopSettingsPage } from './views/ledger-settings.js';
import { renderMarketInfo } from './views/market-info.js';
import { renderTimecard } from './views/timecard.js';
import { startUpdateWatch } from './lib/update-check.js';
import { initShiftBar, setShift, repaintShiftBar } from './lib/shift-bar.js';
import { businessesPanel, reloadAsNewBusiness } from './lib/businesses.js';

const appEl = document.getElementById('app');
const badgeEl = document.getElementById('userBadge');
const navEl = document.getElementById('sidenav');
const navToggle = document.getElementById('navToggle');
const backdrop = document.getElementById('backdrop');
const patchEl = document.getElementById('patchnotes');
initActions(document.getElementById('actionbar'));

const state = { profile: null, me: null };

// A persistent banner (e.g. the subscription-expiry warning) that lives OUTSIDE
// #app, so it survives every route change and shows on all pages.
const globalBanner = document.createElement('div');
globalBanner.id = 'globalBanner';
globalBanner.hidden = true;
appEl.parentNode.insertBefore(globalBanner, appEl);

/**
 * A new version has been deployed and this tab is still running the old one.
 * Set by the update watcher, and sticky: once it is true the notice stays until
 * the page is actually reloaded, because the condition it describes does not go
 * away on its own.
 */
let updateWaiting = false;

/** The update notice — first in the stack, since it explains all the others. */
function updateBannerRow() {
  return el('div', { class: 'global-banner' }, [
    el('span', {}, 'A new version of the Ledger has been released. Refresh to update.'),
    el('button', { class: 'banner-btn', onclick: () => location.reload() }, 'Refresh now'),
  ]);
}

function paintBanners(apiBanners) {
  const rows = updateWaiting ? [updateBannerRow()] : [];
  rows.push(...apiBanners.map((b) => {
    const row = el('div', { class: 'global-banner' }, [el('span', {}, b.text)]);
    if (b.action && b.action.modal === 'lowstock') {
      row.appendChild(el('button', { class: 'banner-btn', onclick: () => openLowStockModal() }, b.action.label || 'Open'));
    } else if (b.action && b.action.route) {
      row.appendChild(el('button', { class: 'banner-btn', onclick: () => navigate(b.action.route) }, b.action.label || 'Open'));
    }
    return row;
  }));
  if (!rows.length) { globalBanner.hidden = true; globalBanner.innerHTML = ''; return; }
  mount(globalBanner, ...rows);
  globalBanner.hidden = false;
}

function refreshGlobalBanner() {
  if (!(state.me && state.me.registered)) {
    globalBanner.hidden = true; globalBanner.innerHTML = '';
    setShift(null);
    return;
  }
  api.getMotd()
    .then((r) => {
      paintBanners((r && r.banners) || (r && r.banner ? [{ text: r.banner }] : []));
      // The shift rides along with the notices — same request, same moments.
      setShift((r && r.shift) || null);
    })
    // An unreachable MOTD must not swallow the update notice — that one is
    // known locally and does not depend on the API being up.
    .catch(() => paintBanners([]));
}
// Views can ask the shell to re-check banners (e.g. after accepting a transfer,
// or after clocking on or off).
window.addEventListener('eec:banners', () => { api.bustMotd(); refreshGlobalBanner(); });

// The header floats (sticky); the action bar sticks just below it. Measure the
// real header height into --topbar-h so the bar never hides under the header.
const topbarEl = document.querySelector('.topbar');
function measureTopbar() {
  if (!topbarEl) return;
  document.documentElement.style.setProperty('--topbar-h', topbarEl.offsetHeight + 'px');
}
window.addEventListener('resize', measureTopbar);
window.addEventListener('load', measureTopbar);
measureTopbar();

// ---- mobile drawer -------------------------------------------------------
function openDrawer() {
  navEl.classList.add('open');
  backdrop.hidden = false;
  navToggle.setAttribute('aria-expanded', 'true');
}
function closeDrawer() {
  navEl.classList.remove('open');
  backdrop.hidden = true;
  navToggle.setAttribute('aria-expanded', 'false');
}
navToggle.addEventListener('click', () => {
  if (navEl.classList.contains('open')) closeDrawer(); else openDrawer();
});
backdrop.addEventListener('click', closeDrawer);

// ---- nav / badge ---------------------------------------------------------
function doSignOut() { signOut(); location.reload(); }

function showNav(on) {
  document.body.classList.toggle('has-nav', on);
  if (on) {
    renderNav(navEl, state.me, closeDrawer, doSignOut);
  } else {
    navEl.innerHTML = '';
    closeDrawer();
  }
  // Patch notes are now a nav page, not a desktop side column.
  if (patchEl) patchEl.innerHTML = '';
}
window.addEventListener('hashchange', () => highlightNav(navEl));

function renderBadge() {
  if (!state.profile) { badgeEl.hidden = true; measureTopbar(); return; }
  badgeEl.hidden = false;
  const registered = state.me && state.me.registered;
  const role = registered ? state.me.role : 'guest';
  const who = (registered && state.me.character) || state.profile.name || state.profile.email || 'Signed in';
  if (registered) {
    // Sign Out now lives only in the nav menu (both desktop and mobile).
    mount(badgeEl,
      el('button', { class: 'badge-chip', onclick: () => navigate('/profile') }, [
        el('span', {}, who + ' · '),
        el('span', { class: 'role-pill' }, role),
      ]),
    );
  } else {
    mount(badgeEl,
      el('span', {}, who + ' · '),
      el('span', { class: 'role-pill' }, role),
      el('button', { onclick: () => { signOut(); location.reload(); } }, 'Sign out'),
    );
  }
  measureTopbar(); // badge changes the header height
}

function fatal(err) {
  mount(appEl, el('div.card', {}, [
    el('h2', {}, 'Setup needed'),
    el('p', { class: 'error' }, err.message || String(err)),
  ]));
}

/** Signed-out landing with a fresh Google sign-in button. */
function renderSignedOutLanding(container) {
  const signInMount = el('div', { style: 'display:inline-block;margin-top:10px' });
  renderLanding(container, { signInMount });
  renderSignInButton(signInMount); // no-op until GIS is initialized
}

// ---- routes --------------------------------------------------------------
function showRoot(container) {
  if (!state.me) { renderSignedOutLanding(container); return; }
  if (state.me.registered) renderHome(container, { me: state.me });
  else navigate('/register');
}
route('/', showRoot);

route('/about', (container) => {
  if (state.me && state.me.registered) renderLanding(container, { me: state.me });
  else renderSignedOutLanding(container);
});

route('/register', (container) => {
  if (!state.profile) { navigate('/'); return; }
  if (state.me && state.me.registered) { navigate('/'); return; }
  renderRegister(container, {
    profile: state.profile,
    onRegistered: (me) => { state.me = me; renderBadge(); showNav(true); navigate('/'); },
  });
});

route('/patch-notes', (container) => {
  const host = el('div', {});
  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    host,
  ]));
  renderPatchNotes(host);
});

route('/court', (container) => {
  const m = state.me;
  // Guarded again by the Worker, which resolves the Court's region from its own
  // company; this only keeps the page out of the way of a typed URL.
  if (!m || !m.registered || !m.court) { navigate('/'); return; }
  renderCourtTools(container, { me: m });
});

route('/feedback', (container) => {
  if (!state.me || !state.me.registered) { navigate('/'); return; }
  renderFeedback(container, { me: state.me });
});

route('/admin/feedback', (container) => {
  // Guarded again server-side; this only keeps the page out of the way of
  // someone who typed the URL.
  if (!state.me || !state.me.systemAdmin) { navigate('/'); return; }
  renderFeedbackAdmin(container, { me: state.me });
});

route('/profile', (container) => {
  if (!state.me || !state.me.registered) { navigate('/'); return; }
  renderProfile(container, {
    me: state.me,
    onProfileUpdated: (me) => { state.me = me; renderBadge(); },
  });
});

/**
 * The nav's Switch Business entry. A page of its own rather than a modal, so
 * the address is linkable and Back behaves — and because switching reloads the
 * app, which a modal would do from underneath itself.
 */
route('/switch', (container) => {
  const m = state.me;
  if (!m || !m.registered) { navigate('/'); return; }
  mount(container, el('div.card', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/') }, '← Back'),
    el('h2', {}, 'Your businesses'),
    businessesPanel(m, reloadAsNewBusiness),
  ]));
});

route('/employees', (container) => {
  const m = state.me;
  if (!m || !m.registered || !canManage(m)) { navigate('/'); return; }
  renderEmployees(container, { me: m });
});

route('/inventory', (container) => {
  if (!state.me || !state.me.registered) { navigate('/'); return; }
  renderInventory(container, { me: state.me });
});

// Last week's trade in this shop's own region. Owner-level, like Employees —
// the Worker enforces it too; this only keeps the door from opening on a page
// that would refuse.
route('/market-info', (container) => {
  const m = state.me;
  if (!m || !m.registered || !canManage(m)) { navigate('/'); return; }
  renderMarketInfo(container, { me: m });
});

// The Sales Log's two sections moved onto the Shop Ledger. Kept as a redirect
// rather than deleted: the address is in people's history, on the home screen
// of anyone who installed the app, and inside a cached offline shell.
route('/sales-log', () => navigate('/ledger'));

// Clocking on and off. Everyone who works a shift; the shop-wide log inside is
// owner-only, enforced per section rather than at the door.
route('/timecard', (container) => {
  if (!state.me || !state.me.registered) { navigate('/'); return; }
  renderTimecard(container, { me: state.me });
});

// The Shop Ledger — what the shop has done (sales, deliveries) and how it is
// doing (performance, notices, coffers). Distinct from Shop Settings at
// /ledger/settings, which is where the things you CHANGE live.
//
// Open to any member, NOT managers only: the sales and deliveries it now holds
// were always open to whoever works the till, and shutting the door on the page
// would have taken away an employee's ability to void a sale they mis-rang. The
// page offers different sections by role instead.
route('/ledger', (container) => {
  const m = state.me;
  if (!m || !m.registered) { navigate('/'); return; }
  renderLedgerSettings(container, { me: m });
});

// The restock report as a page. The same report opens as a modal from the
// banner nudge, where you are mid-task and need to dismiss it.
route('/restock', (container) => {
  const m = state.me;
  if (!m || !m.registered || !canManage(m)) { navigate('/'); return; }
  renderLowStock(container, { me: m });
});

route('/pos', (container) => {
  if (!state.me || !state.me.registered) { navigate('/'); return; }
  renderPos(container, { me: state.me, mode: 'sell' });
});

// The register's other sides — stock coming in, grown, or made. Each its own
// route rather than a tab, so Back works and a half-built cart survives a look
// at the deliveries.
route('/pos/buy', (container) => {
  if (!state.me || !state.me.registered) { navigate('/'); return; }
  renderPos(container, { me: state.me, mode: 'buy' });
});

route('/pos/harvest', (container) => {
  if (!state.me || !state.me.registered) { navigate('/'); return; }
  renderPos(container, { me: state.me, mode: 'harvest' });
});

route('/pos/craft', (container) => {
  if (!state.me || !state.me.registered) { navigate('/'); return; }
  renderPos(container, { me: state.me, mode: 'craft' });
});

route('/admin/settings', (container) => {
  if (!state.me || !state.me.registered || state.me.role !== 'admin') { navigate('/'); return; }
  renderAdminSettings(container, { me: state.me });
});

route('/admin/motd', (container) => {
  if (!state.me || !state.me.registered || state.me.role !== 'admin') { navigate('/'); return; }
  renderMotdAdmin(container);
});

route('/admin/audit', (container) => {
  if (!state.me || !state.me.registered || state.me.role !== 'admin') { navigate('/'); return; }
  renderAudit(container);
});

route('/admin/items', (container) => {
  if (!state.me || !state.me.registered || state.me.role !== 'admin') { navigate('/'); return; }
  renderItemIndex(container);
});

route('/admin/members', (container) => {
  if (!state.me || !state.me.registered || state.me.role !== 'admin') { navigate('/'); return; }
  renderMembers(container, { me: state.me });
});

route('/admin/companies', (container) => {
  if (!state.me || !state.me.registered || state.me.role !== 'admin') { navigate('/'); return; }
  renderCompanies(container, { me: state.me });
});

route('/admin/realms', (container) => {
  if (!state.me || !state.me.registered || state.me.role !== 'admin') { navigate('/'); return; }
  renderRealms(container, { me: state.me, onRealmChanged: refreshRealm });
});

/**
 * Re-reads the profile after a realm switch and redraws. Every page is scoped to
 * the active realm, so the safest thing after a switch is to go back to the
 * Admin Panel with fresh identity rather than leave a page showing stale data.
 */
async function refreshRealm() {
  api.bustTiles(); // artwork is per realm
  api.bustRef();   // so are the item index and the region list
  api.bustMotd();
  state.me = await api.me();
  if (state.me && state.me.branding) applyBranding(state.me.branding);
  if (state.me && state.me.prefs) { setCurrency(state.me.prefs.currency); setRegion(state.me.prefs); setItemTags(state.me.prefs.itemTags); setCertification(state.me.prefs); }
  setSessionUser(state.me);
  renderBadge();
  showNav(true);
  navigate('/');
  render();
}

function adminMarket(tab) {
  return (container) => {
    if (!state.me || !state.me.registered || state.me.role !== 'admin') { navigate('/'); return; }
    renderMarket(container, { tab });
  };
}
route('/admin/market', adminMarket('overview'));
route('/admin/market/items', adminMarket('items'));
route('/admin/market/regions', adminMarket('regions'));
route('/admin/market/companies', adminMarket('companies'));
route('/admin/market/trends', adminMarket('trends'));

route('/ledger/settings', (container) => {
  const m = state.me;
  if (!m || !m.registered || !canManage(m)) { navigate('/'); return; }
  renderShopSettingsPage(container, {
    me: m,
    onBusinessRenamed: (me) => { state.me = me; renderBadge(); render(); },
  });
});

// ---- boot ----------------------------------------------------------------
async function onSignedIn() {
  state.profile = getProfile();
  mount(appEl, el('p', { class: 'loading' }, 'Checking the registry…'));
  try {
    state.me = await api.me();
  } catch (e) {
    fatal(e);
    return;
  }
  // Re-brand for the caller's realm. Before sign-in the app wears the
  // deployment's identity (there is no realm to know about yet); now that we
  // know who they are, a realm hosting its own server can look like itself.
  if (state.me && state.me.branding) applyBranding(state.me.branding);
  if (state.me && state.me.prefs) { setCurrency(state.me.prefs.currency); setRegion(state.me.prefs); setItemTags(state.me.prefs.itemTags); setCertification(state.me.prefs); }
  setSessionUser(state.me);
  renderBadge();
  showNav(!!(state.me && state.me.registered));
  // Watch for a deploy from here on. Started after sign-in because the notice
  // has nowhere to appear before it, and a signed-out visitor loading the page
  // is getting the current version anyway.
  startUpdateWatch(() => { updateWaiting = true; refreshGlobalBanner(); });
  refreshGlobalBanner();
  navigate(state.me.registered ? '/' : '/register');
  render(); // paint even if the hash was already the target
}

async function main() {
  applyPrefs(); // apply saved GUI theme before anything paints
  applyLang();  // translate the shell + every subsequent render to the chosen language

  let config;
  try {
    config = await loadConfig();
  } catch (e) {
    fatal(e);
    return;
  }
  configureApi(config.apiBaseUrl);
  loadBranding(); // sitewide name/logo/favicon (public — also brands the landing)
  initRouter(appEl, showRoot);
  onBeforeRender(clearActions); // reset per-view action buttons before each render
  // The shift bar hides itself on the Time Card, so it has to be repainted
  // when the route changes — not only when /motd is re-read.
  initShiftBar();
  onBeforeRender(repaintShiftBar);

  renderSignedOutLanding(appEl); // initial view (button appears once GIS is ready)
  onAuthChange(({ idToken }) => { if (idToken) onSignedIn(); });
  // The API base goes in too: sign-in trades the Google token for a 24-hour
  // session of ours, which auth.js fetches for itself (it cannot import the API
  // client — the API client imports it).
  await initAuth(config.googleClientId, config.apiBaseUrl);
  // GIS is ready now — re-render so the sign-in button paints (unless one-tap
  // already signed the user in).
  if (!state.profile) renderSignedOutLanding(appEl);
}

main();

// ---- PWA: register the service worker (installable + offline app shell) ----
// Resolved against the document URL so it works under the GitHub Pages subpath;
// the default scope is the app directory, which covers every route.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', location.href)).catch(() => { /* offline shell is best-effort */ });
  });
}
