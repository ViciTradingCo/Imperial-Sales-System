/**
 * App bootstrap + shell: navigation (sidebar / mobile drawer), routing, and the
 * signed-out landing. Each panel is its own route/page, selected from the nav.
 */
import { loadConfig } from './lib/config.js';
import { initAuth, renderSignInButton, onAuthChange, getProfile, signOut } from './lib/auth.js';
import { configureApi, api } from './lib/api.js';
import { initRouter, route, navigate, render, onBeforeRender } from './lib/router.js';
import { el, mount } from './lib/dom.js';
import { renderNav, highlightNav } from './lib/nav.js';
import { applyPrefs } from './lib/theme.js';
import { renderPatchNotes } from './lib/patch-notes.js';
import { initActions, clearActions } from './lib/actions.js';
import { renderLanding } from './views/landing.js';
import { renderHome } from './views/home.js';
import { renderRegister } from './views/register.js';
import { renderProfile } from './views/profile.js';
import { renderEmployees } from './views/employees.js';
import { renderInventory } from './views/inventory.js';
import { renderPos } from './views/pos.js';
import { renderAdminSettings } from './views/admin-settings.js';
import { renderMembers } from './views/members.js';
import { renderCompanies } from './views/companies.js';
import { renderLedgerSettings } from './views/ledger-settings.js';

const appEl = document.getElementById('app');
const badgeEl = document.getElementById('userBadge');
const navEl = document.getElementById('sidenav');
const navToggle = document.getElementById('navToggle');
const backdrop = document.getElementById('backdrop');
const patchEl = document.getElementById('patchnotes');
initActions(document.getElementById('actionbar'));

const state = { profile: null, me: null };

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
    renderPatchNotes(patchEl);
  } else {
    navEl.innerHTML = '';
    patchEl.innerHTML = '';
    closeDrawer();
  }
}
window.addEventListener('hashchange', () => highlightNav(navEl));

function renderBadge() {
  if (!state.profile) { badgeEl.hidden = true; measureTopbar(); return; }
  badgeEl.hidden = false;
  const registered = state.me && state.me.registered;
  const role = registered ? state.me.role : 'guest';
  const who = (registered && state.me.character) || state.profile.name || state.profile.email || 'Signed in';
  if (registered) {
    mount(badgeEl,
      el('button', { class: 'badge-chip', onclick: () => navigate('/profile') }, [
        el('span', {}, who + ' · '),
        el('span', { class: 'role-pill' }, role),
      ]),
      // Desktop sign-out sits by the nameplate; on mobile it's in the drawer.
      el('button', { class: 'topbar-signout', onclick: doSignOut }, 'Sign Out'),
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
  if (state.me && state.me.registered) renderLanding(container, {});
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

route('/profile', (container) => {
  if (!state.me || !state.me.registered) { navigate('/'); return; }
  renderProfile(container, {
    me: state.me,
    onProfileUpdated: (me) => { state.me = me; renderBadge(); },
  });
});

route('/employees', (container) => {
  const m = state.me;
  if (!m || !m.registered || (m.role !== 'owner' && m.role !== 'admin')) { navigate('/'); return; }
  renderEmployees(container, { me: m });
});

route('/inventory', (container) => {
  if (!state.me || !state.me.registered) { navigate('/'); return; }
  renderInventory(container, { me: state.me });
});

route('/pos', (container) => {
  if (!state.me || !state.me.registered) { navigate('/'); return; }
  renderPos(container, { me: state.me });
});

route('/admin/settings', (container) => {
  if (!state.me || !state.me.registered || state.me.role !== 'admin') { navigate('/'); return; }
  renderAdminSettings(container);
});

route('/admin/members', (container) => {
  if (!state.me || !state.me.registered || state.me.role !== 'admin') { navigate('/'); return; }
  renderMembers(container);
});

route('/admin/companies', (container) => {
  if (!state.me || !state.me.registered || state.me.role !== 'admin') { navigate('/'); return; }
  renderCompanies(container);
});

route('/ledger/settings', (container) => {
  const m = state.me;
  if (!m || !m.registered || (m.role !== 'owner' && m.role !== 'admin')) { navigate('/'); return; }
  renderLedgerSettings(container, {
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
  renderBadge();
  showNav(!!(state.me && state.me.registered));
  navigate(state.me.registered ? '/' : '/register');
  render(); // paint even if the hash was already the target
}

async function main() {
  applyPrefs(); // apply saved GUI theme before anything paints

  let config;
  try {
    config = await loadConfig();
  } catch (e) {
    fatal(e);
    return;
  }
  configureApi(config.apiBaseUrl);
  initRouter(appEl, showRoot);
  onBeforeRender(clearActions); // reset per-view action buttons before each render

  renderSignedOutLanding(appEl); // initial view (button appears once GIS is ready)
  onAuthChange(({ idToken }) => { if (idToken) onSignedIn(); });
  await initAuth(config.googleClientId);
  // GIS is ready now — re-render so the sign-in button paints (unless one-tap
  // already signed the user in).
  if (!state.profile) renderSignedOutLanding(appEl);
}

main();
