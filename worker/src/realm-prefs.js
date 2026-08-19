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
  /**
   * WHAT KINDS OF THING this realm trades in — food, drink, a weapon.
   *
   * The vocabulary is the REALM'S, and a shop tags its own listings from it.
   * Free text per shop was the alternative and drifts within a week ("drink",
   * "drinks", "Drink"), which matters here more than it looks: a special asks
   * for five DRINK, and a tag that is nearly right buys nothing.
   *
   * The default is Skyrim's own categories, so a realm that never opens this
   * screen can still tag its stock on the day it signs up.
   */
  itemTags: [
    'Food', 'Drink', 'Potion', 'Poison', 'Weapon', 'Armor', 'Clothing',
    'Jewelry', 'Book', 'Scroll', 'Soul Gem', 'Ore', 'Ingot', 'Pelt', 'Gem', 'Misc',
  ],
};

/** How many kinds a realm may name, and how long a name may be. */
const MAX_TAGS = 40;
const MAX_TAG_LEN = 24;

/**
 * Cleans a realm's tag vocabulary: trimmed, deduplicated case-insensitively,
 * and free of commas — the listing stores its tags comma-joined, so a comma in
 * a name would silently become two tags.
 */
function cleanTagList(input) {
  const out = [];
  const seen = new Set();
  for (const raw of (Array.isArray(input) ? input : [])) {
    const name = String(raw || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LEN);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  if (out.length > MAX_TAGS) throw new Error('A realm can name at most ' + MAX_TAGS + ' kinds of item.');
  return out;
}

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
  // Removing a kind leaves it on any listing already carrying it — the tag is
  // stored on the row, and quietly stripping stock of what it IS because a
  // vocabulary was edited would be a far worse surprise than an orphan tag.
  if (input.itemTags !== undefined) next.itemTags = cleanTagList(input.itemTags);
  if (input.trialDays !== undefined) {
    const d = Math.floor(Number(input.trialDays));
    if (!isFinite(d) || d < 0 || d > 365) throw new Error('New-shop trial must be between 0 and 365 days.');
    next.trialDays = d;
  }
  await setFlag(env, key(realmId), JSON.stringify(next));
  return next;
}
