/**
 * Branding — the app name, logo, and shared iconography an admin can change
 * without a redeploy. Stored as JSON blobs in sys_flags and served PUBLICLY (the
 * sign-in screen must be branded before anyone authenticates).
 *
 * TWO LAYERS. Sitewide branding is the deployment's own identity and is what an
 * anonymous visitor sees, since before sign-in there is no realm to know about.
 * A realm may then override any field, so a second RP server hosted here can
 * carry its own name and logo instead of inheriting the first one's. Anything a
 * realm leaves blank falls through to sitewide, so a realm that doesn't care
 * about branding needs to set nothing.
 *
 * Images are external https:// links (the app hosts no uploads), matching the
 * tile-image approach.
 */
import { getFlag, setFlag } from './db.js';

const KEY = 'branding';
/** Per-realm overrides live under their own key. */
function realmKey(realmId) {
  return KEY + ':' + String(realmId || '');
}
const HTTPS_URL = /^https:\/\/[^\s"'<>]+$/i;

const BRANDING_DEFAULTS = {
  appName: 'Vici Trading Co.',
  shortName: 'Vici Ledger',
  tagline: 'The Vici Automated Ledger',
  logoUrl: '',
  faviconUrl: '',
  footerText: 'The Vici Automated Ledger · created by SmileDaemon',
  accent: '',
  // The About page. aboutBody is free text; blank lines separate paragraphs and
  // lines beginning with "- " render as bullets.
  aboutTitle: '',
  aboutBody: '',
  aboutCredits: '',
  // The tip jar under Credits. The wording defaults to blank like the rest of
  // the About page (the frontend supplies the stock copy), but the two LINKS
  // have real defaults — a button with no destination is not a fallback, it is
  // a broken control, so a blank supportUrl HIDES the section instead.
  supportTitle: '',
  supportBody: '',
  supportUrl: 'https://ko-fi.com/smiledaemon',
  supportImageUrl: 'https://ko-fi.com/img/githubbutton_sm.svg',
};

const TEXT_FIELDS = ['appName', 'shortName', 'tagline', 'footerText', 'aboutTitle', 'supportTitle'];
const LONG_FIELDS = ['aboutBody', 'aboutCredits', 'supportBody'];
const URL_FIELDS = ['logoUrl', 'faviconUrl', 'supportUrl', 'supportImageUrl'];

async function readBlob(env, key) {
  try {
    const raw = await getFlag(env, key);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}

/** Drops empty values so a blank realm field falls through to sitewide. */
function pruned(obj) {
  const out = {};
  Object.keys(obj || {}).forEach((k) => {
    if (obj[k] !== '' && obj[k] != null) out[k] = obj[k];
  });
  return out;
}

/**
 * The branding in force. With no realm this is the deployment's own identity
 * (what a signed-out visitor sees); with a realm, that realm's overrides layered
 * on top.
 */
export async function readBranding(env, realmId) {
  const site = await readBlob(env, KEY);
  const realm = realmId ? pruned(await readBlob(env, realmKey(realmId))) : {};
  return { ...BRANDING_DEFAULTS, ...site, ...realm };
}

/** Just one realm's overrides, unmerged — what its editing form should show. */
export async function readRealmBranding(env, realmId) {
  return await readBlob(env, realmKey(realmId));
}

/**
 * Saves branding. With a realmId this writes that realm's OVERRIDES — a blank
 * field there means "inherit", so blanks are stored as empty and pruned on read
 * rather than being merged over the sitewide value.
 */
export async function writeBranding(env, input, realmId) {
  const next = {};
  TEXT_FIELDS.forEach((f) => {
    if (input[f] === undefined) return;
    next[f] = String(input[f] || '').trim().slice(0, 120);
  });
  LONG_FIELDS.forEach((f) => {
    if (input[f] === undefined) return;
    next[f] = String(input[f] || '').trim().slice(0, 4000);
  });
  URL_FIELDS.forEach((f) => {
    if (input[f] === undefined) return;
    const url = String(input[f] || '').trim();
    if (!url) { next[f] = ''; return; }
    if (!HTTPS_URL.test(url)) throw new Error('Image links must be full https:// URLs (' + f + ').');
    next[f] = url.slice(0, 500);
  });
  if (input.accent !== undefined) {
    const a = String(input.accent || '').trim();
    if (a && !/^#[0-9a-f]{3,8}$/i.test(a)) throw new Error('Accent must be a hex colour like #7a4a1f.');
    next.accent = a;
  }
  if (realmId) {
    const merged = { ...(await readRealmBranding(env, realmId)), ...next };
    await setFlag(env, realmKey(realmId), JSON.stringify(merged));
    return await readBranding(env, realmId);
  }
  const merged = { ...(await readBlob(env, KEY)), ...next };
  await setFlag(env, KEY, JSON.stringify(merged));
  return { ...BRANDING_DEFAULTS, ...merged };
}
