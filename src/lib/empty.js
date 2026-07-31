/**
 * Friendly empty states — a glyph, a title, a line of guidance, and (optionally)
 * the action that fills the void. Better than a bare "No items."
 */
import { el } from './dom.js';

export function emptyState({ glyph, title, hint, actionLabel, onAction }) {
  const nodes = [
    el('span', { class: 'empty-glyph', 'aria-hidden': 'true' }, glyph || '📭'),
    el('div', { class: 'empty-title' }, title || 'Nothing here yet'),
  ];
  if (hint) nodes.push(el('p', { class: 'note' }, hint));
  if (actionLabel && onAction) {
    nodes.push(el('div', { class: 'row-actions' }, [
      el('button.primary', { onclick: onAction }, actionLabel),
    ]));
  }
  return el('div', { class: 'empty-state' }, nodes);
}
