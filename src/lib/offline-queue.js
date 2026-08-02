/**
 * Offline-tolerant register queue. When a checkout can't reach the API (flaky
 * event wifi), the sale is stashed in localStorage and replayed when the network
 * returns. Because every checkout carries an idempotency key, replaying a sale
 * that actually did go through is a no-op server-side — so the queue can retry
 * freely without ringing anything up twice.
 *
 * Each entry is stamped with the realm AND the business it was rung up in. A
 * queued sale belongs to the world it was made in: if a System Admin switches
 * realms (or a user is moved) before the queue drains, replaying it would post
 * a sale into the wrong realm's books. Those entries are held back rather than
 * misfiled — see flushSales.
 */
const KEY = 'eec.offline.sales';

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
}
function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* storage full/blocked */ }
}

/** True if an error looks like a transient network failure (vs. a real rejection). */
export function isNetworkError(e) {
  const m = (e && e.message) || String(e || '');
  return /Could not reach the API|Failed to fetch|NetworkError|Load failed|network/i.test(m);
}

export function queuedCount() { return read().length; }

/** Stash a sale payload for later replay, tagged with where it was made. */
export function enqueueSale(sale, me) {
  const list = read();
  list.push({
    sale,
    at: Date.now(),
    realmId: (me && (me.homeRealm || me.activeRealm)) || '',
    business: (me && me.business) || '',
  });
  write(list);
}

/**
 * Replays queued sales via checkoutFn(sale). Stops at the first network error
 * (keeping that sale and everything after it for the next attempt). A permanent
 * rejection (e.g. validation) drops that one sale and continues.
 *
 * Entries stamped for a different realm or business than the current session are
 * HELD, not replayed: the server would happily accept them against whatever
 * realm the session is now in, which is how an offline sale ends up in the wrong
 * world's books. They flush on their own the next time that user signs in.
 *
 * Returns { flushed, remaining, held }.
 */
export async function flushSales(checkoutFn, me) {
  const list = read();
  if (!list.length) return { flushed: 0, remaining: 0, held: 0 };
  const realmNow = (me && (me.homeRealm || me.activeRealm)) || '';
  const businessNow = (me && me.business) || '';

  const keep = [];
  let flushed = 0, held = 0, offline = false;
  for (const entry of list) {
    // Entries from before this stamp existed have no realm; treat them as this
    // session's, which is the old behaviour and the only sane guess.
    const sameWorld = (!entry.realmId || entry.realmId === realmNow)
      && (!entry.business || entry.business === businessNow);
    if (!sameWorld) { keep.push(entry); held++; continue; }
    if (offline) { keep.push(entry); continue; } // already lost the network
    try { await checkoutFn(entry.sale); flushed++; }
    catch (e) {
      if (isNetworkError(e)) { offline = true; keep.push(entry); }
      // permanent failure — drop this sale (it can never succeed) and continue
    }
  }
  write(keep);
  return { flushed, remaining: keep.length, held };
}
