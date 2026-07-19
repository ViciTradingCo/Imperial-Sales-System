/**
 * Google Identity Services wrapper — the browser side of authentication.
 *
 * Flow: GIS gives us a signed Google ID token (a JWT proving the user's
 * verified email). We NEVER trust it here for authorization; we hand it to the
 * Worker API, which verifies the signature and maps the email to a UID / role /
 * business in the Core. The browser only ever knows "I am signed in as this
 * email" — every access decision is the API's job.
 *
 * The ID token is kept in memory (not localStorage) and refreshed via GIS.
 */
let idToken = null;
let profile = null; // { email, name, picture } from the decoded token payload
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

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() { listeners.forEach((fn) => fn({ idToken, profile })); }

export function getIdToken() { return idToken; }
export function getProfile() { return profile; }

let initialized = false;

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
        callback: (resp) => {
          idToken = resp.credential;
          profile = decodePayload(idToken);
          emit();
        },
        // Persistent session: silently re-issue a token for a returning user on
        // reload (Google tokens last ~1h; this re-auths without a click). An
        // explicit Sign Out calls disableAutoSelect so it stays signed out.
        auto_select: true,
      });
      initialized = true;
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
  idToken = null;
  profile = null;
  if (window.google && window.google.accounts && window.google.accounts.id) {
    window.google.accounts.id.disableAutoSelect();
  }
  emit();
}
