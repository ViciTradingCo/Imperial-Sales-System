/**
 * Money — one rule, in one place.
 *
 * THE RULE: fractional input is accepted, every RESULT is a whole number,
 * rounded DOWN. A shop may price something at 22.5 if its fiction wants to, and
 * the arithmetic in between is exact — but the figure that gets stored, moved,
 * owed or shown is a whole coin, and the fraction is dropped rather than
 * rounded up. Trade here is in coins; half a coin is not a thing anyone hands
 * over.
 *
 * WHY DOWN AND NOT NEAREST. Rounding to nearest means half the time the shop
 * charges MORE than the arithmetic said, which is the one direction a customer
 * notices. Down is always in the payer's favour, and it never invents money that
 * did not exist — a hundred sales rounded down cannot inflate a coffer.
 *
 * THE FLOAT TAIL. Money summed in JavaScript drifts — 0.1 + 0.2 is
 * 0.30000000000000004 — so a day's takings can arrive as 1239.9999999999998,
 * which flooring alone would report as 1239. A coin lost to arithmetic noise.
 *
 * So the tail is settled BEFORE the fraction is dropped. The precision of that
 * settle matters more than it looks: settling to 2dp would also turn a genuine
 * 12.999 into 13, rounding UP, which is the one thing this must never do. Six
 * places is far below anything a person would type and far above the noise
 * (which lands around the fifteenth significant digit), so it catches the drift
 * and nothing else.
 */

/** How close to a whole coin still counts as that coin: float noise, not a price. */
const SETTLE = 1e6;

/**
 * An amount as it will actually be recorded: whole coins, rounded down.
 * Anything that is not a finite number is nothing.
 */
export function coin(n) {
  const v = Number(n);
  if (!isFinite(v)) return 0;
  return Math.floor(Math.round(v * SETTLE) / SETTLE);
}
