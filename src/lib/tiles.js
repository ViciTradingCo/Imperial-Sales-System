/**
 * Big-button tile grid — the app's primary navigation pattern. Each tile is a
 * large square button; tapping it opens that section in a focal menu (modal)
 * instead of stacking cards down the page.
 *
 * A tile's artwork is an image URL assigned by an admin (Tile Images in the
 * admin panel); when none is set it falls back to a glyph so the grid always
 * looks intentional.
 *
 *   tileGrid([{ key, label, hint, glyph, onOpen }], images)
 */
import { el } from './dom.js';
import { openModal } from './modal.js';
import { suspendActions, resumeActions } from './actions.js';

/**
 * Opens a section as a focal menu. `build(host, modal)` fills the modal body —
 * it can be a small form, or an existing page view rendered into `host`.
 * `wide` (default true) gives full sections room to breathe.
 *
 * The page's action bar is SUSPENDED for as long as the menu is open. Views
 * built as pages call setActions when they render, and opening one in a modal
 * used to raise its bar above the overlay — visible, unreachable, and belonging
 * to a page you are no longer looking at. Suspending here fixes it for every
 * view at once, including ones not written yet.
 */
export function openFocalMenu(title, build, opts) {
  const options = opts || {};
  const host = el('div', { class: 'focal-body' });
  suspendActions();
  const modal = openModal(
    [el('h3', { class: 'focal-title' }, title), host],
    { wide: options.wide !== false, onClose: resumeActions }
  );
  build(host, modal);
  return modal;
}

/**
 * Builds the tile list for a page's sections.
 *
 * A section either OPENS its content in a focal menu (`open`) or GOES to a whole
 * page (`goto`) — never both. Every caller used to wrap sections in a focal menu
 * unconditionally, so a section that navigated showed an empty modal over the
 * page it had just moved to. Declaring the two cases separately makes that
 * impossible to write by accident.
 */
export function sectionTiles(sections, navigate) {
  return (sections || []).filter(Boolean).map((s) => ({
    key: s.key,
    label: s.label,
    hint: s.hint,
    glyph: s.glyph,
    onOpen: s.goto
      ? () => navigate(s.goto)
      : () => openFocalMenu(s.label, (host) => s.open(host)),
  }));
}

/** Builds the tile grid element. `images` maps tile key → image URL. */
export function tileGrid(tiles, images) {
  const imgs = images || {};
  return el('div', { class: 'tile-grid' }, (tiles || []).filter(Boolean).map((t) => {
    const url = imgs[t.key];
    const art = url
      ? el('img', { class: 'tile-art', src: url, alt: '', loading: 'lazy' })
      : el('span', { class: 'tile-glyph', 'aria-hidden': 'true' }, t.glyph || '◆');
    const btn = el('button', {
      type: 'button', class: 'tile', onclick: () => t.onOpen(),
      title: t.hint || t.label,
    }, [
      art,
      el('span', { class: 'tile-label' }, t.label),
      t.hint ? el('span', { class: 'tile-hint' }, t.hint) : el('span', {}),
    ]);
    // A broken/blocked image URL shouldn't leave an empty box.
    if (url) {
      art.addEventListener('error', () => {
        art.replaceWith(el('span', { class: 'tile-glyph', 'aria-hidden': 'true' }, t.glyph || '◆'));
      });
    }
    return btn;
  }));
}
