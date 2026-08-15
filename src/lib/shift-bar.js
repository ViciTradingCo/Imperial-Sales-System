/**
 * THE SHIFT BAR — floats over the page for as long as you are clocked in.
 *
 * A shift is the one thing the app knows about you that you can leave running
 * by accident, and the cost of that lands in somebody else's ledger: hours
 * nobody worked, or a shift an owner has to go and correct by hand. So it is
 * not a notice at the top of a page you may already have scrolled past — it
 * floats at the bottom of the viewport, on every page, until the shift ends.
 *
 * FIXED at the bottom rather than added to the banner stack, because the stack
 * scrolls away with the page and because the bottom of a phone is where a thumb
 * already is.
 *
 * Its one button NAVIGATES to the Time Card rather than clocking you out where
 * you stand. Ending a shift is deliberate, and has a note attached; a stray tap
 * on a bar that follows you everywhere is the least deliberate thing there is.
 *
 * It draws NO MONEY. An open shift is worth nothing yet (see timecard.js), and
 * a figure ticking upward in the corner of every screen invites clocking out to
 * make it stop.
 *
 * The data comes from /motd with the notices — same request, same moments — so
 * this owns no clock of its own beyond the minute tick that re-words "2h 15m".
 */
import { el, mount } from './dom.js';
import { navigate, currentPath } from './router.js';

/** Where the Time Card lives, and the one page the bar stays out of. */
const TIMECARD = '/timecard';

let host = null;
/** The open shift as /motd last reported it: { clockIn, hours, long } or null. */
let shift = null;

/** "2h 15m" — how long the shift has run, worked out from its own start time. */
function shiftElapsed(startedAt) {
  const ms = Date.now() - new Date(startedAt).getTime();
  if (!isFinite(ms) || ms < 0) return '';
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  return (h ? h + 'h ' : '') + (mins % 60) + 'm';
}

/**
 * Mounts the bar's strip on the body and starts the minute tick.
 *
 * The elapsed figure is recomputed from the START TIME every minute rather than
 * counted up from the number the server sent, so a tab left open overnight is
 * right when you come back to it instead of an hour behind.
 */
export function initShiftBar() {
  if (host) return;
  host = document.createElement('div');
  host.id = 'shiftBar';
  host.hidden = true;
  document.body.appendChild(host);
  setInterval(repaintShiftBar, 60000);
}

/** What /motd said. Null clears the bar. */
export function setShift(open) {
  shift = open || null;
  repaintShiftBar();
}

/** Redraws from what it already knows — for a route change or the minute tick. */
export function repaintShiftBar() {
  if (!host) return;
  // Nothing on the Time Card itself: the button would lead where you already
  // are, and the page says everything the bar does and more.
  if (!shift || currentPath() === TIMECARD) {
    host.hidden = true;
    host.innerHTML = '';
    document.body.classList.remove('has-shift');
    return;
  }
  const elapsed = shiftElapsed(shift.clockIn);
  mount(host, el('div', { class: 'shift-float' + (shift.long ? ' long' : '') }, [
    // A long shift says so. The Worker decides what long MEANS; this only wears
    // it, so the two cannot drift apart on the threshold.
    el('span', { class: 'shift-float-text' },
      (shift.long ? '⚠ Still clocked in' : '⏱️ Clocked in') + (elapsed ? ' · ' + elapsed : '')),
    el('button', { class: 'banner-btn', onclick: () => navigate(TIMECARD) }, 'Time Card'),
  ]));
  host.hidden = false;
  document.body.classList.add('has-shift');
}
