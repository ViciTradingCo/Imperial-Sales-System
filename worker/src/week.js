/**
 * When the week turns over — ONE definition, for everything that happens weekly.
 *
 * There were two, and they disagreed. Market Info rolled at Monday 00:00 UTC;
 * the backup reminder fired on Sundays. So the "end of the week" nudge arrived a
 * full day before the week's figures actually settled, and anyone acting on the
 * reminder was backing up a week the reports still called unfinished. Two
 * definitions of a week is one too many: everything weekly now turns at the same
 * instant, and this file is that instant.
 *
 * MONDAY 00:00 UTC. Monday because a week of trading reads as Monday-to-Sunday
 * and its figures are complete when Sunday ends. UTC because the realm spans
 * time zones and the week has to turn over at the same moment for all of them —
 * otherwise two shops comparing notes are reading different weeks, and neither
 * is wrong.
 */

const DAY_MS = 86400000;

/** Which weekday begins the week, as getUTCDay() numbers it (1 = Monday). */
const WEEK_START_DAY = 1;

/** Midnight UTC on the given day, as epoch ms. */
function midnightOf(at) {
  return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
}

function asDate(now) {
  return now instanceof Date ? now : new Date(now || Date.now());
}

/** The instant the CURRENT week began. Every weekly thing turns over here. */
export function weekStart(now) {
  const at = asDate(now);
  // getUTCDay is 0 for Sunday; shift so the configured start day is 0.
  const since = (at.getUTCDay() - WEEK_START_DAY + 7) % 7;
  return new Date(midnightOf(at) - since * DAY_MS);
}

/**
 * The last COMPLETE week, as a half-open [from, to) window.
 *
 * Half-open is what makes a run of weeks cover every moment exactly once — a
 * closed range would count midnight twice, in both the week that ended and the
 * one that began.
 */
export function lastWeekWindow(now) {
  const start = weekStart(now).getTime();
  return {
    from: new Date(start - 7 * DAY_MS).toISOString(),
    to: new Date(start).toISOString(),
  };
}

/**
 * True during the first day of the week — the window in which a once-a-week
 * nudge fires.
 *
 * A day rather than an instant because nobody is holding the app open at
 * midnight UTC: the reminder has to still be there when they next sign in. It
 * begins at the same moment the week's figures roll, so a prompt to back up the
 * week arrives when that week is actually finished.
 */
export function isWeekTurnover(now) {
  return asDate(now).getUTCDay() === WEEK_START_DAY;
}
