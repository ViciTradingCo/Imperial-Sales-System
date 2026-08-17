/**
 * How a BULK THING reads as one line.
 *
 * A delivery, a haul, a crate — each is several items recorded as one act, and
 * each needs a name when it appears somewhere that holds one line per act: a
 * coffer entry, an audit detail, a row in a list of pending transfers.
 *
 * One definition, because the alternative is three. The coffer saying
 * "Iron Sword ×2" while the audit log says "Iron Sword, Ale, Rope" for the same
 * delivery is how two screens come to disagree about what happened.
 */

/** Lines as `{ item, qty }` — anything with more is welcome, the rest is ignored. */
export function lineSummary(lines) {
  const rows = (lines || []).filter(Boolean);
  if (!rows.length) return '';
  const first = String(rows[0].item || '') + ' ×' + (Math.floor(Number(rows[0].qty)) || 0);
  return rows.length === 1 ? first : first + ' + ' + (rows.length - 1) + ' more';
}
