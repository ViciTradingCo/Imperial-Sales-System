/**
 * THE SHAPE OF A LOG YOU CAN SEARCH — shared by the sales log, the coffer and
 * the deliveries list.
 *
 * All three are the same thing wearing different columns: a shop's own rows,
 * newest first, narrowed by a date window and walked a page at a time. Written
 * once because the ways they go wrong are identical and silent — a window that
 * drops the last day, a count that belongs to a different query than the rows,
 * a page past the end that reads as an empty log.
 */

/**
 * A half-open window from two plain dates — "YYYY-MM-DD", as a date input
 * gives them. Either side may be blank, meaning unbounded there.
 *
 * HALF-OPEN, for the reason `week.js` gives: `to` names a whole DAY, so the
 * window runs to the start of the day AFTER it. A closed `ts <= to` would keep
 * only what happened in the first instant of the last day chosen and drop the
 * rest of it — and the mistake reads as "that day had no trade", which is the
 * worst way for a filter to be wrong.
 *
 * UTC, also like the week, and for the same reason: the realm spans time zones
 * and a day has to mean the same day to every shop in it, or two people
 * comparing a Tuesday are comparing different ones. What it costs is that a
 * shop several hours from UTC sees its own late evening filed under the next
 * day; fixing that means the client sending its offset, which is worth doing
 * the day somebody notices and not before.
 */
export function dayWindow(from, to) {
  return { from: startOfDay(from), to: startOfDay(to, 1) };
}

/** Midnight UTC on a "YYYY-MM-DD", plus `plusDays`. '' for anything unparseable. */
function startOfDay(day, plusDays = 0) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || '').trim());
  if (!m) return '';
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const base = new Date(Date.UTC(y, mo, d));
  /*
   * IT HAS TO ROUND-TRIP. `Date.UTC` does not refuse a month of 13 or a 45th
   * day — it rolls them forward, so "2026-13-45" becomes a perfectly real
   * 14 February 2027 and the log is filtered by a date nobody typed, with
   * nothing on screen to say so. Checking the parts back out is what tells a
   * real date from one that merely looks like one.
   *
   * An unparseable bound is NO bound, never a bound of zero: filtering from
   * the epoch would quietly show everything, which at least is honest, but
   * filtering TO it would show nothing and read as an empty log.
   */
  if (base.getUTCFullYear() !== y || base.getUTCMonth() !== mo || base.getUTCDate() !== d) return '';
  return new Date(base.getTime() + plusDays * 86400000).toISOString();
}

/**
 * The window as SQL, ready to append to a WHERE that already has something in
 * it. Returns no clause at all when neither side was given.
 *
 * `col` is interpolated because it is a column name this code chose, never
 * anything a caller sent — the same arrangement as `notArchived(col)` in
 * market.js. The dates themselves are bound.
 */
export function tsWindow(col, from, to) {
  const w = dayWindow(from, to);
  const sql = [];
  const binds = [];
  if (w.from) { sql.push(` AND ${col} >= ?`); binds.push(w.from); }
  if (w.to) { sql.push(` AND ${col} < ?`); binds.push(w.to); }
  return { sql: sql.join(''), binds };
}

/** How big a page is, everywhere. The server's to decide — see `pageOf`. */
export const PAGE_SIZE = 25;

/**
 * Which page a request actually gets, CLAMPED to what exists.
 *
 * A page past the end is answered with the last real one rather than with
 * nothing: an empty answer looks exactly like an empty log, which is the one
 * thing a history is there to stop somebody believing. Below the first, or not
 * a number at all, is page one.
 *
 * The SIZE is not a parameter a caller can name. A client that could ask for
 * the lot in one response would get a slow query, a large payload and a screen
 * rendering ten thousand rows; it is returned instead, so a view can draw a
 * pager without having to know the figure.
 */
export function pageOf(total, requested, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, Math.floor(Number(requested) || 1)), pages);
  return { page, pages, offset: (page - 1) * size, pageSize: size, total };
}
