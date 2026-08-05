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
 * DECIMALS ONLY WHEN THERE ARE DECIMALS. Trade here is in whole coins — a sale
 * is 25gp, not 25.00gp — so a ledger reading "1240.00gp" was inventing a
 * precision the shop does not use, on every figure on the page. A fractional
 * amount (a percentage discount off an odd number, say) still prints its two
 * places, because there the decimal is real.
 *
 * The rounding comes FIRST and is not optional. Revenue is summed in JavaScript
 * in places, and floating point makes those sums drift: 0.1 + 0.2 is
 * 0.30000000000000004, and a day's takings can land on 1240.0000000000002.
 * Settling to 2dp before asking "is this a whole number?" is what stops that
 * drift from printing — the old toFixed(2) was hiding it rather than resolving
 * it, which is why it never showed up as a bug until the .00 came off.
 */
export function money(n) {
  const v = Number(n);
  if (!isFinite(v)) return '0' + unit;
  const settled = Math.round(v * 100) / 100;
  return (Number.isInteger(settled) ? String(settled) : settled.toFixed(2)) + unit;
}
