/**
 * Formatting helpers.
 *
 * The denomination is a per-realm setting (Realm Management → Network Settings),
 * so it is set once from the signed-in profile rather than hard-coded. It starts
 * as "gp" and every amount in the app renders through here, which is why there
 * is a single mutable value instead of threading it through every caller.
 */
let unit = 'gp';
let region = { label: 'Region', shown: true };

/** Sets the denomination for the rest of the session. Called at sign-in. */
export function setCurrency(c) { unit = String(c || 'gp').trim() || 'gp'; }
export function currency() { return unit; }

/**
 * Region wording and visibility, from the realm's preferences.
 *
 * Both are set once at sign-in for the same reason the denomination is: they
 * are presentation, every screen needs them, and threading them through every
 * render function would guarantee somewhere gets missed — which is exactly what
 * happened when only the register honoured them.
 */
export function setRegion(prefs) {
  region = {
    label: String((prefs && prefs.regionLabel) || 'Region').trim() || 'Region',
    shown: !prefs || prefs.showRegion !== false,
  };
}
/** What this realm calls a region, capitalised for labels. */
export function regionLabel() { return region.label; }
/** The same, lowercased for mid-sentence use. */
export function regionWord() { return region.label.toLowerCase(); }
/** Whether this realm uses regions at all. False hides every region surface. */
export function regionsOn() { return region.shown; }

export function money(n) {
  const v = Number(n);
  return (isFinite(v) ? v.toFixed(2) : '0.00') + unit;
}
