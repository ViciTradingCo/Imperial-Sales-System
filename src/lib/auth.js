/**
 * Sign-in — the browser side of authentication.
 *
 * TWO CREDENTIALS, ONE JOB. Google proves who you are, once: Sign-In hands us a
 * signed ID token, we send it to the Worker, and the Worker trades it for a
 * SESSION TOKEN of its own that lasts 24 hours. Everything after that carries
 * the session token. The Google token is never stored and never used twice.
 *
 * WHY. A Google ID token lasts an hour and cannot be extended. It also lived
 * only in a JS variable, so any page reload lost it — including the reload a
 * phone forces when it reclaims a backgrounded tab, which is what people were
 * hitting as "it logs me out every ten minutes". A day-long credential in
 * localStorage survives reloads, tab closes, and the phone putting the app to
 * sleep; sign-in is now something you do once a day.
 *
 * WHY NOT A COOKIE. The site and the API are on different hosts (github.io and
 * workers.dev), so a session cookie would be a third-party cookie: SameSite=None
 * is required, Safari blocks it outright, and Chrome restricts it. It would work
 * for some people and silently fail for others, which is the one thing a login
 * must never do. localStorage plus the Authorization header behaves the same on
 * every browser, and it is the same token either way.
 *
 * SIGNING OUT STAYS SIGNED OUT. Sign Out revokes the session on the server, so
 * the token is dead everywhere rather than merely forgotten here, and disables
 * Google's auto-select so the next visit shows the sign-in button.
 */
const STORE_KEY = 'vici.session';
/** Re-establish this long before expiry, so a call never rides a dying token. */
const RENEW_MARGIN_MS = 5 * 60 * 1000;

let sessionToken = null;
let expiresAt = 0;       // ms since the epoch
let profile = null;      // { email, name, picture } — for display only
let renewTimer = null;
let apiBase = '';
const listeners = new Set();

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() { listeners.forEach((fn) => fn({ idToken: sessionToken, profile })); }

/** The credential to send to the API. Named for its use, not its issuer. */
export function getIdToken() { return sessionToken; }
export function getProfile() { return profile; }

let initialized = false;

function store() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ token: sessionToken, expires: expiresAt, profile }));
  } catch (e) { /* private mode — the session just won't outlive the tab */ }
}

function forget() {
  sessionToken = null;
  expiresAt = 0;
  profile = null;
  if (renewTimer) { clearTimeout(renewTimer); renewTimer = null; }
  try { localStorage.removeItem(STORE_KEY); } catch (e) { /* nothing to clear */ }
}

function scheduleRenew() {
  if (renewTimer) clearTimeout(renewTimer);
  if (!expiresAt) return;
  // Never in the past, and never a tight retry loop.
  const wait = Math.max(30 * 1000, expiresAt - Date.now() - RENEW_MARGIN_MS);
  renewTimer = setTimeout(promptGoogle, wait);
}

/**
 * Trades a Google credential for a session. This is the only time a Google
 * token is used, and it is not kept afterwards.
 */
async function exchange(credential) {
  const res = await fetch(apiBase + '/auth/session', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'text/plain;charset=utf-8' },
    body: '{}',
  });
  if (!res.ok) throw new Error('Sign-in failed (' + res.status + ').');
  const data = await res.json();
  sessionToken = data.token;
  expiresAt = new Date(data.expires).getTime() || (Date.now() + 24 * 60 * 60 * 1000);
  profile = { email: data.email, name: data.name || '', picture: data.picture || '' };
  store();
  scheduleRenew();
  emit();
}

/**
 * Asks Google for a credential without showing anything, if it can. With
 * auto_select on and consent already given, a returning user is signed back in
 * silently; otherwise One Tap appears, which is the honest fallback.
 */
function promptGoogle() {
  if (!initialized || !window.google || !window.google.accounts || !window.google.accounts.id) return;
  try { window.google.accounts.id.prompt(); } catch (e) { /* nothing more we can do */ }
}

/**
 * Called by the API client when the Worker rejects our credential — a revoked
 * session, or a database that lost the row. Drops it and asks Google for a new
 * one, rather than dumping the user on the sign-in screen for something they
 * cannot see and did not cause.
 */
let recovering = false;
export function handleUnauthorized() {
  if (recovering) return;
  recovering = true;
  forget();
  emit();
  promptGoogle();
  // One attempt per few seconds: a run of failing calls must not become a run
  // of One Tap prompts.
  setTimeout(() => { recovering = false; }, 5000);
}

/**
 * Initializes sign-in. Resolves once a stored session has been restored (if
 * there is one) and Google Sign-In is configured and ready.
 */
export function initAuth(clientId, apiBaseUrl) {
  apiBase = String(apiBaseUrl || '').replace(/\/$/, '');

  // A session from a previous visit, if it has life left in it. Restored before
  // Google is even asked: the whole point is that a returning user is already
  // signed in, with no network round trip and nothing to click.
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { saved = null; }
  if (saved && saved.token && saved.expires > Date.now() + RENEW_MARGIN_MS) {
    sessionToken = saved.token;
    expiresAt = saved.expires;
    // Never null while signed in: the shell reads name/email straight off it.
    profile = saved.profile || { email: '', name: '' };
    scheduleRenew();
    emit();
  } else if (saved) {
    forget(); // expired, or about to be
  }

  return new Promise((resolve) => {
    const ready = () => {
      if (!window.google || !window.google.accounts || !window.google.accounts.id) {
        setTimeout(ready, 50);
        return;
      }
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp) => {
          if (resp && resp.credential) exchange(resp.credential).catch(() => { /* the button stays */ });
        },
        // Sign a returning user back in without making them click. They have
        // already consented; asking again is friction, not security.
        auto_select: true,
      });
      initialized = true;
      // No live session: ask Google now rather than waiting for a click. If the
      // browser is still signed in to Google this completes silently.
      if (!sessionToken) promptGoogle();
      resolve();
    };
    ready();
  });
}

/** Renders the Google sign-in button into `mountEl` (call after initAuth). */
export function renderSignInButton(mountEl) {
  if (!initialized || !mountEl) return;
  window.google.accounts.id.renderButton(mountEl, {
    theme: 'filled_black',
    size: 'large',
    text: 'signin_with',
    shape: 'pill',
  });
  window.google.accounts.id.prompt(); // one-tap, if eligible
}

/**
 * Signs out for real: the session is revoked server-side (so the token cannot
 * be replayed from anywhere it was copied), cleared locally, and Google's
 * auto-select is switched off so the next visit does not sign straight back in.
 */
export function signOut() {
  const token = sessionToken;
  if (token && apiBase) {
    // Fire-and-forget: the local sign-out must not wait on the network, and an
    // unreachable API is not a reason to stay signed in on this device.
    fetch(apiBase + '/auth/signout', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'text/plain;charset=utf-8' },
      body: '{}',
      keepalive: true,
    }).catch(() => {});
  }
  forget();
  if (window.google && window.google.accounts && window.google.accounts.id) {
    window.google.accounts.id.disableAutoSelect();
  }
  emit();
}
