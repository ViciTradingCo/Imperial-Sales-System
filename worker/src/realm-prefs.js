/**
 * Realm preferences — the per-realm settings that aren't numbers.
 *
 * master_settings stores REAL values, which is right for the market thresholds
 * but can't hold a currency name or a checkbox. These live in sys_flags as one
 * JSON blob per realm instead, under 'realm_prefs:<realm>'.
 *
 * PER REALM, like everything else: each server names its own money and decides
 * whether its register asks which region a sale happened in. Changing one
 * realm's preferences never touches another's.
 */
import { getFlag, setFlag, DEFAULT_REALM_ID } from './db.js';

export const PREFS_DEFAULTS = {
  /** What the money is called. Shown after every amount across the app. */
  currency: 'gp',
  /**
   * Whether the register asks which region a sale happened in.
   *
   * A server whose fiction has no regional trade doesn't want the field, and a
   * required dropdown they always answer the same way is friction. Off means
   * the register omits it and sales record no region — the region reports still
   * work, they just have nothing to group.
   */
  showRegion: true,
  /** What a "region" is called in this realm's fiction (Hold, Province, Sector…). */
  regionLabel: 'Region',
  /**
   * Days of certification a newly founded shop opens with.
   *
   * A founder code should mean you can trade immediately, so a new shop starts
   * certified rather than EXPIRED. How long that grace lasts is a realm's own
   * call: 0 means no trial at all (an admin must certify by hand).
   */
  trialDays: 7,
};

function key(realmId) {
  return 'realm_prefs:' + String(realmId || DEFAULT_REALM_ID);
}

export async function readRealmPrefs(env, realmId) {
  let stored = {};
  try {
    const raw = await getFlag(env, key(realmId));
    stored = raw ? JSON.parse(raw) : {};
  } catch (e) { stored = {}; }
  return { ...PREFS_DEFAULTS, ...stored };
}

export async function writeRealmPrefs(env, input, realmId) {
  const cur = await readRealmPrefs(env, realmId);
  const next = { ...cur };
  if (input.currency !== undefined) {
    const c = String(input.currency || '').trim().slice(0, 12);
    if (!c) throw new Error('Enter what the money is called (e.g. gp, credits, ₽).');
    next.currency = c;
  }
  if (input.regionLabel !== undefined) {
    const r = String(input.regionLabel || '').trim().slice(0, 24);
    next.regionLabel = r || PREFS_DEFAULTS.regionLabel;
  }
  if (input.showRegion !== undefined) next.showRegion = !!input.showRegion;
  if (input.trialDays !== undefined) {
    const d = Math.floor(Number(input.trialDays));
    if (!isFinite(d) || d < 0 || d > 365) throw new Error('New-shop trial must be between 0 and 365 days.');
    next.trialDays = d;
  }
  await setFlag(env, key(realmId), JSON.stringify(next));
  return next;
}
