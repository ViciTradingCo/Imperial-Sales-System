/**
 * App bootstrap for Phase 1 (Foundation).
 *
 * Responsibilities right now:
 *   1. Load public config.
 *   2. Initialize Google Sign-In.
 *   3. On sign-in, call the API's /auth/me and show who the API says we are
 *      (UID / role / business), or route to registration when unknown.
 *
 * Later phases add the router + the four role-scoped views. This file
 * deliberately stays thin — it proves the auth round-trip end to end.
 */
import { loadConfig } from './lib/config.js';
import { initAuth, onAuthChange, getProfile, signOut } from './lib/auth.js';
import { configureApi, api } from './lib/api.js';

const appEl = document.getElementById('app');
const badgeEl = document.getElementById('userBadge');

function fatal(err) {
  appEl.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h2>Setup needed</h2>';
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = err.message || String(err);
  card.appendChild(p);
  appEl.appendChild(card);
}

function renderSignIn() {
  appEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'card signin-wrap';
  wrap.innerHTML =
    '<h2>Sign in</h2>' +
    '<p>Sign in with the Google account you use for the East Empire network. ' +
    'Your access is decided by the Company registry — new faces are asked to register.</p>';
  const mount = document.createElement('div');
  mount.style.display = 'inline-block';
  mount.style.marginTop = '10px';
  wrap.appendChild(mount);
  appEl.appendChild(wrap);
  return mount;
}

function renderBadge(profile, me) {
  badgeEl.hidden = false;
  badgeEl.innerHTML = '';
  const label = document.createElement('span');
  const role = me && me.registered ? me.role : 'guest';
  label.textContent = (profile.name || profile.email || 'Signed in') + ' · ';
  const pill = document.createElement('span');
  pill.className = 'role-pill';
  pill.textContent = role;
  const out = document.createElement('button');
  out.textContent = 'Sign out';
  out.onclick = () => { signOut(); location.reload(); };
  badgeEl.appendChild(label);
  badgeEl.appendChild(pill);
  badgeEl.appendChild(out);
}

async function onSignedIn() {
  const profile = getProfile();
  appEl.innerHTML = '<p class="loading">Checking the registry…</p>';
  let me;
  try {
    me = await api.me();
  } catch (e) {
    fatal(e);
    return;
  }
  renderBadge(profile, me);

  if (me && me.registered) {
    // Phase 1 stop-point: confirm the round-trip worked. Phase 2 replaces this
    // with the registration flow + role-scoped router.
    appEl.innerHTML =
      '<div class="card">' +
      '<h2>You\'re in the registry ✓</h2>' +
      '<p><b>UID:</b> ' + esc(me.uid) + '<br>' +
      '<b>Business:</b> ' + esc(me.business || '—') + '<br>' +
      '<b>Role:</b> ' + esc(me.role) + '</p>' +
      '<p class="ok">Auth round-trip verified. The role-scoped views land in the next phases.</p>' +
      '</div>';
  } else {
    appEl.innerHTML =
      '<div class="card">' +
      '<h2>Welcome, new trader</h2>' +
      '<p>Your Google account isn\'t in the East Empire registry yet. ' +
      'Registration (disclose your business, or register a new business as its owner) ' +
      'is built in Phase 2.</p>' +
      '<p class="note">Signed in as ' + esc(profile.email || '') + '.</p>' +
      '</div>';
  }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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

  const mount = renderSignIn();
  onAuthChange(({ idToken }) => { if (idToken) onSignedIn(); });
  await initAuth(config.googleClientId, mount);
}

main();
