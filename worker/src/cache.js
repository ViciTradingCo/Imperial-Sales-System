/**
 * Two-tier cache for hot identity/registry reads: a per-isolate in-memory layer
 * (always on) plus an optional Cloudflare KV layer (cross-isolate) that turns on
 * automatically when a `KV` binding exists — see wrangler.toml. Until KV is
 * provisioned, this is exactly the in-memory cache, so it's zero-risk.
 *
 * IMPORTANT: only cache POSITIVE lookups where short staleness is acceptable.
 * Never cache "not found" for identity, or a just-registered user could appear
 * missing until the entry expires. Busts clear the in-memory layer immediately;
 * KV entries lapse by their short TTL (a precise KV prefix-bust isn't worth its
 * list+delete cost at this scale).
 */
const mem = new Map();

function memGet(key) {
  const e = mem.get(key);
  if (!e) return undefined;
  if (Date.now() > e.exp) { mem.delete(key); return undefined; }
  return e.val;
}
function memSet(key, val, ttlMs) { mem.set(key, { val, exp: Date.now() + ttlMs }); }

export async function cacheGet(env, key) {
  const local = memGet(key);
  if (local !== undefined) return local;
  if (env && env.KV) {
    try {
      const v = await env.KV.get(key, 'json');
      if (v != null) { memSet(key, v, 30000); return v; }
    } catch (e) { /* KV hiccup — fall through to a fresh read */ }
  }
  return undefined;
}

export async function cacheSet(env, key, val, ttlMs) {
  memSet(key, val, ttlMs);
  if (env && env.KV) {
    try { await env.KV.put(key, JSON.stringify(val), { expirationTtl: Math.max(60, Math.round(ttlMs / 1000)) }); }
    catch (e) { /* best-effort */ }
  }
}

/** Drops in-memory entries under `prefix` (KV entries lapse by their TTL). */
export function cacheBust(prefix) {
  for (const k of mem.keys()) if (k.startsWith(prefix)) mem.delete(k);
}
