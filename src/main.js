/**
 * App bootstrap (Phase 2).
 *
 *   1. Load public config, init Google Sign-In.
 *   2. On sign-in, ask the API who we are (/auth/me).
 *   3. Registered → role-scoped dashboard. Unknown → registration flow.
 *
 * The router is set up for the per-role views that later phases add; for now it
 * carries two screens (dashboard + register) chosen from the API's answer.
 */
import { loadConfig } from './lib/config.js';
import { initAuth, onAuthChange, getProfile, signOut } from './lib/auth.js';
import { configureApi, api } from './lib/api.js';
import { initRouter, route, navigate, render } from './lib/router.js';
import { el, mount } from './lib/dom.js';
import { renderRegister } from './views/register.js';
import { renderDashboard } from './views/dashboard.js';

const appEl = document.getElementById('app');
const badgeEl = document.getElementById('userBadge');

// Single source of truth for the signed-in session.
const state = { profile: null, me: null };

function fatal(err) {
  mount(appEl, el('div.card', {}, [
    el('h2', {}, 'Setup needed'),
    el('p', { class: 'error' }, err.message || String(err)),
  ]));
}

function renderSignIn() {
  const mountPoint = el('div', { style: 'display:inline-block;margin-top:10px' });
  mount(appEl, el('div.card.signin-wrap', {}, [
    el('h2', {}, 'Sign in'),
    el('p', {}, 'Sign in with the Google account you use for the East Empire network. ' +
      'Your access is decided by the Company registry.'),
    mountPoint,
  ]));
  return mountPoint;
}

function renderBadge() {
  if (!state.profile) { badgeEl.hidden = true; return; }
  badgeEl.hidden = false;
  const role = state.me && state.me.registered ? state.me.role : 'guest';
  mount(badgeEl,
    el('span', {}, (state.profile.name || state.profile.email || 'Signed in') + ' · '),
    el('span', { class: 'role-pill' }, role),
    el('button', { onclick: () => { signOut(); location.reload(); } }, 'Sign out'),
  );
}

// ---- routes -------------------------------------------------------------
function showRoot(container) {
  if (!state.me) { renderSignIn(); return; }
  if (state.me.registered) renderDashboard(container, { me: state.me });
  else navigate('/register');
}
route('/', showRoot);

route('/register', (container) => {
  if (!state.profile) { navigate('/'); return; }
  if (state.me && state.me.registered) { navigate('/'); return; }
  renderRegister(container, {
    profile: state.profile,
    onRegistered: (me) => { state.me = me; renderBadge(); navigate('/'); },
  });
});

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
  navigate(state.me.registered ? '/' : '/register');
  render(); // ensure the chosen route paints even if the hash was already set
}

async function main() {
  let config;
  try {
    config = await loadConfig();
  } catch (e) {
    fatal(e);
    return;
  }
  configureApi(config.apiBaseUrl);
  initRouter(appEl, showRoot); // unknown hashes fall back to the root screen

  const mountPoint = renderSignIn();
  onAuthChange(({ idToken }) => { if (idToken) onSignedIn(); });
  await initAuth(config.googleClientId, mountPoint);
}

main();
