/**
 * Sitewide branding — the app name, logo, and shared iconography an admin can
 * change without a redeploy. Stored as one JSON blob in sys_flags and served
 * PUBLICLY (the sign-in screen must be branded before anyone authenticates).
 *
 * Images are external https:// links (the app hosts no uploads), matching the
 * tile-image approach.
 */
import { getFlag, setFlag } from './db.js';

const KEY = 'branding';
const HTTPS_URL = /^https:\/\/[^\s"'<>]+$/i;

export const BRANDING_DEFAULTS = {
  appName: 'Vici Trading Co.',
  shortName: 'Vici Ledger',
  tagline: 'The Vici Automated Ledger',
  logoUrl: '',
  faviconUrl: '',
  footerText: 'The Vici Automated Ledger · created by SmileDaemon',
  accent: '',
};

const TEXT_FIELDS = ['appName', 'shortName', 'tagline', 'footerText'];
const URL_FIELDS = ['logoUrl', 'faviconUrl'];

export async function readBranding(env) {
  let stored = {};
  try {
    const raw = await getFlag(env, KEY);
    stored = raw ? JSON.parse(raw) : {};
  } catch (e) { stored = {}; }
  return { ...BRANDING_DEFAULTS, ...stored };
}

export async function writeBranding(env, input) {
  const next = {};
  TEXT_FIELDS.forEach((f) => {
    if (input[f] === undefined) return;
    next[f] = String(input[f] || '').trim().slice(0, 120);
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
  const merged = { ...(await readBranding(env)), ...next };
  await setFlag(env, KEY, JSON.stringify(merged));
  return merged;
}
