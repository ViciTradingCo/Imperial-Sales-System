/**
 * Google Identity Services wrapper — the browser side of authentication.
 *
 * Flow: GIS gives us a signed Google ID token (a JWT proving the user's
 * verified email). We NEVER trust it here for authorization; we hand it to the
 * Worker API, which verifies the signature and maps the email to a UID / role /
 * business in D1. The browser only ever knows "I am signed in as this email" —
 * every access decision is the API's job.
 *
 * KEEPING THE SESSION ALIVE. The token used to live in a JS variable and
 * nowhere else, with silent re-auth switched off and no renewal. That meant:
 *
 *   • any page reload signed you out;
 *   • a phone reclaiming a backgrounded tab discarded the page, and returning
 *     to it reloaded — so you were signed out, over and over, which is what
 *     people were hitting as "it logs me out every ten minutes";
 *   • and after an hour the token expired with nothing to renew it.
 *
 * So the token is now held in sessionStorage, restored on load while it is
 * still valid, silently reissued before it expires, and reissued again if the
 * API ever rejects it. sessionStorage rather than localStorage: it survives the
 * reload of a discarded tab, which is the actual problem, without leaving a
 * credential on disk after the tab closes.
 */
const STORE_KEY = 'vici.idtoken';
/** Reissue this long before expiry, so a call never rides an expiring token. */
const RENEW_MARGIN_MS = 5 * 60 * 1000;

let idToken = null;
let profile = null; // { email, name, picture, exp } from the decoded payload
let renewTimer = null;
const listeners = new Set();

/** Decode a JWT payload for DISPLAY ONLY (never for trust). */
function decodePayload(jwt) {
  try {
    const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch (e) {
    return {};
  }
}

/** When this token stops being accepted, in ms since the epoch (0 if unknown). */
function expiryOf(payload) {
  const exp = Number(payload && payload.exp);
  return isFinite(exp) && exp > 0 ? exp * 1000 : 0;
}

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() { listeners.forEach((fn) => fn({ idToken, profile })); }

export function getIdToken() { return idToken; }
export function getProfile() { return profile; }

let initialized = false;

/** Takes a freshly issued credential: stores it, schedules its renewal. */
function adopt(credential) {
  idToken = credential;
  profile = decodePayload(credential);
  try { sessionStorage.setItem(STORE_KEY, credential); } catch (e) { /* private mode */ }
  scheduleRenew();
  emit();
}

function forget() {
  idToken = null;
  profile = null;
  if (renewTimer) { clearTimeout(renewTimer); renewTimer = null; }
  try { sessionStorage.removeItem(STORE_KEY); } catch (e) { /* nothing to clear */ }
}

/**
 * Asks GIS for a credential without showing anything, if it can. With
 * auto_select on and consent already given, a returning user is signed back in
 * silently; otherwise One Tap appears, which is the honest fallback.
 */
function renew() {
  if (!initialized || !window.google || !window.google.accounts || !window.google.accounts.id) return;
  try { window.google.accounts.id.prompt(); } catch (e) { /* nothing more we can do here */ }
}

function scheduleRenew() {
  if (renewTimer) clearTimeout(renewTimer);
  const at = expiryOf(profile);
  if (!at) return;
  // Never schedule in the past, and never sit in a tight retry loop.
  const wait = Math.max(30 * 1000, at - Date.now() - RENEW_MARGIN_MS);
  renewTimer = setTimeout(renew, wait);
}

/**
 * Called by the API client when the Worker rejects our credential. Drops the
 * dead token and asks for a new one — a 401 mid-session is what an expired
 * token looks like from here, and signing the user out on it would be exactly
 * the behaviour being complained about.
 */
let recovering = false;
export function handleUnauthorized() {
  if (recovering) return;
  recovering = true;
  forget();
  emit();
  renew();
  // One attempt per few seconds: a run of failing calls must not become a run
  // of One Tap prompts.
  setTimeout(() => { recovering = false; }, 5000);
}

/** Initializes GIS. Resolves once the library is ready and configured. */
export function initAuth(clientId) {
  return new Promise((resolve) => {
    const ready = () => {
      if (!window.google || !window.google.accounts || !window.google.accounts.id) {
        setTimeout(ready, 50);
        return;
      }
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp) => { if (resp && resp.credential) adopt(resp.credential); },
        // Sign a returning user back in without making them click. They have
        // already consented; asking again on every reload is friction, not
        // security, and it is what made the app unusable on a phone.
        auto_select: true,
      });
      initialized = true;

      // A token from before this page load, if it has life left in it.
      let stored = null;
      try { stored = sessionStorage.getItem(STORE_KEY); } catch (e) { stored = null; }
      if (stored) {
        const payload = decodePayload(stored);
        const at = expiryOf(payload);
        if (at && at - Date.now() > RENEW_MARGIN_MS) {
          idToken = stored;
          profile = payload;
          scheduleRenew();
          emit();
        } else {
          // Expired or about to be: drop it and ask for a fresh one rather than
          // letting the first API call fail.
          forget();
          renew();
        }
      }
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

export function signOut() {
  forget();
  if (window.google && window.google.accounts && window.google.accounts.id) {
    // Signing out must STAY signed out: without this, auto_select would sign
    // the same account straight back in.
    window.google.accounts.id.disableAutoSelect();
  }
  emit();
}
