/**
 * THE BAR ABOVE A LOG — a window of days, and the button that clears it.
 *
 * The sales log, the coffer and the deliveries list are three views of the same
 * shape: a shop's own rows, newest first, narrowed and then walked a page at a
 * time. This is the narrowing, written once, so all three ask their question in
 * the same words and in the same place on the screen.
 *
 * `onChange` is called whenever a date is picked or cleared. It is given
 * nothing: the caller reads `value()` when it is ready to ask, which keeps the
 * bar from having an opinion about what a page does with it.
 */
import { el } from './dom.js';

/**
 * `opts.note` is the placeholder for the free-text box, or '' for a bar with no
 * text box at all — the deliveries list has nothing written on it to search.
 */
export function logFilter({ note = '', onChange }) {
  const from = el('input', { type: 'date', 'aria-label': 'From date' });
  const to = el('input', { type: 'date', 'aria-label': 'To date' });
  const text = note ? el('input', { type: 'text', placeholder: note, 'aria-label': note }) : null;

  const value = () => ({
    from: from.value || '',
    to: to.value || '',
    q: text ? text.value.trim() : '',
  });
  const dirty = () => !!(from.value || to.value || (text && text.value.trim()));

  // Shown only once there is something to clear. A permanent Clear beside an
  // empty pair of dates is a button that does nothing, and the one moment it
  // matters is the moment a filter is on and the list looks empty.
  const clear = el('button.secondary-btn.small', {
    onclick: () => {
      from.value = ''; to.value = '';
      if (text) text.value = '';
      sync();
      onChange();
    },
  }, 'Clear');

  function sync() { clear.hidden = !dirty(); }
  sync();

  [from, to].forEach((d) => d.addEventListener('change', () => { sync(); onChange(); }));
  if (text) {
    // Enter searches, the way it would in any search box; typing alone does
    // not, or every letter would be a round trip.
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sync(); onChange(); }
    });
  }

  const bar = el('div', { class: 'log-filter' }, [
    ...(text ? [text] : []),
    el('label', { class: 'log-filter-day' }, [el('span', { class: 'note' }, 'From'), from]),
    el('label', { class: 'log-filter-day' }, [el('span', { class: 'note' }, 'To'), to]),
    ...(text ? [el('button.secondary-btn.small', { onclick: () => { sync(); onChange(); } }, 'Search')] : []),
    clear,
  ]);

  return { bar, value, dirty };
}
