/**
 * Loading skeletons — placeholder blocks shaped like the content that's coming,
 * so the layout doesn't jump when data lands (and the wait feels shorter than a
 * bare "Loading…" line).
 */
import { el } from './dom.js';

/** N shimmering lines. `widths` optionally varies them, e.g. ['80%','60%']. */
export function skeletonLines(n, widths) {
  const count = Math.max(1, Number(n) || 3);
  const w = widths || ['92%', '78%', '85%', '64%'];
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push(el('div', { class: 'skeleton-line', style: 'width:' + w[i % w.length] }));
  }
  return el('div', { class: 'skeleton', 'aria-busy': 'true', 'aria-label': 'Loading' }, rows);
}

/** Skeleton shaped like a list of rows (avatar-ish block + two lines each). */
export function skeletonRows(n) {
  const count = Math.max(1, Number(n) || 4);
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push(el('div', { class: 'skeleton-row' }, [
      el('div', { class: 'skeleton-line', style: 'width:55%' }),
      el('div', { class: 'skeleton-line skeleton-sm', style: 'width:35%' }),
    ]));
  }
  return el('div', { class: 'skeleton', 'aria-busy': 'true', 'aria-label': 'Loading' }, rows);
}
