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

/**
 * An amount, in this realm's denomination.
 *
 * WHOLE COINS, ROUNDED DOWN. Prices may be typed with a fraction — the register
 * and the inventory both accept 22.5 — but nothing here deals in half a coin, so
 * every amount SHOWN is a whole number with the fraction dropped, never rounded
 * up. This mirrors `worker/src/money.js`, which applies the same rule to what
 * gets stored, so a figure on screen is the figure in the ledger.
 *
 * The float tail is settled BEFORE the fraction is dropped, at six places —
 * below anything a person would type, above the noise a summed ledger carries.
 * Without it 1239.9999999999998 would print as 1239; at two places a genuine
 * 12.999 would print as 13, rounding up. See worker/src/money.js.
 */
export function money(n) {
  const v = Number(n);
  if (!isFinite(v)) return '0' + unit;
  return String(Math.floor(Math.round(v * 1e6) / 1e6)) + unit;
}
