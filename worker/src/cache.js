/**
 * Tiny in-memory TTL cache (per Worker isolate). Cuts repeated Google Sheets
 * reads on hot paths — the service-account read budget is the binding
 * constraint. Staleness is bounded by the TTL and by explicit busts on writes;
 * the cache is per-isolate (not global), which is exactly the safe amount of
 * caching for this workload — no external binding required.
 *
 * IMPORTANT: only cache POSITIVE lookups where a short staleness is acceptable.
 * Never cache "not found" for identity, or a just-registered user could appear
 * missing until the entry expires.
 */
const store = new Map();

export function cacheGet(key) {
  const e = store.get(key);
  if (!e) return undefined;
  if (Date.now() > e.exp) { store.delete(key); return undefined; }
  return e.val;
}

export function cacheSet(key, val, ttlMs) {
  store.set(key, { val, exp: Date.now() + ttlMs });
}

/** Drops every entry whose key starts with `prefix` (call on the matching write). */
export function cacheBust(prefix) {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
