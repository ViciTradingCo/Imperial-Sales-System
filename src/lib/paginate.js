/** A Prev/Next pager bar for client-side paging of an already-loaded list. */
import { el } from './dom.js';

export function pager(total, page, pageSize, onGo) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  const bar = el('div', { class: 'pager' }, [
    el('button.secondary-btn.small', { onclick: () => onGo(p - 1), disabled: p <= 1 }, 'Prev'),
    el('span', { class: 'note' }, 'Page ' + p + ' of ' + pages + ' · ' + total + ' total'),
    el('button.secondary-btn.small', { onclick: () => onGo(p + 1), disabled: p >= pages }, 'Next'),
  ]);
  return { page: p, pages, start: (p - 1) * pageSize, end: p * pageSize, bar };
}
