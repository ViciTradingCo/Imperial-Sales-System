/**
 * Offline-tolerant register queue. When a checkout can't reach the API (flaky
 * event wifi), the sale is stashed in localStorage and replayed when the network
 * returns. Because every checkout carries an idempotency key, replaying a sale
 * that actually did go through is a no-op server-side — so the queue can retry
 * freely without ringing anything up twice.
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

/** Stash a sale payload for later replay. */
export function enqueueSale(sale) {
  const list = read();
  list.push({ sale, at: Date.now() });
  write(list);
}

/**
 * Replays queued sales via checkoutFn(sale). Stops at the first network error
 * (keeping that sale and everything after it for the next attempt). A permanent
 * rejection (e.g. validation) drops that one sale and continues. Returns
 * { flushed, remaining }.
 */
export async function flushSales(checkoutFn) {
  const list = read();
  if (!list.length) return { flushed: 0, remaining: 0 };
  let i = 0, flushed = 0;
  for (; i < list.length; i++) {
    try { await checkoutFn(list[i].sale); flushed++; }
    catch (e) {
      if (isNetworkError(e)) break; // still offline — keep this and the rest
      // permanent failure — drop this sale (it can never succeed) and continue
    }
  }
  const remaining = list.slice(i);
  write(remaining);
  return { flushed, remaining: remaining.length };
}
