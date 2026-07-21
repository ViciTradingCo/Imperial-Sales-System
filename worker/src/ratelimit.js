/**
 * Lightweight per-isolate rate limiting + a request-size guard. This is abuse
 * protection, not fine throttling: generous fixed-window limits keyed by the
 * caller's token (or IP when unauthenticated). Businesses an admin marks as
 * "priority" get a much higher ceiling — their tokens are learned at /auth/me.
 *
 * Per-isolate (in-memory) is the right amount here; a determined attacker spread
 * across isolates is better handled at the edge, but this stops the common
 * runaway-client / hot-loop case cheaply.
 */
const windows = new Map(); // key -> { count, reset }
const priorityTokens = new Set();

const DEFAULT_PER_MIN = 120;
const PRIORITY_PER_MIN = 600;
const WINDOW_MS = 60000;

export const MAX_BODY_BYTES = 262144; // 256 KB

export function markPriority(token, on) {
  if (!token) return;
  if (on) priorityTokens.add(token); else priorityTokens.delete(token);
}
export function isPriorityToken(token) { return !!token && priorityTokens.has(token); }

export function rateHit(key, isPriority) {
  const now = Date.now();
  if (windows.size > 5000 && Math.random() < 0.02) {
    for (const [k, b] of windows) if (now > b.reset) windows.delete(k);
  }
  let b = windows.get(key);
  if (!b || now > b.reset) { b = { count: 0, reset: now + WINDOW_MS }; windows.set(key, b); }
  b.count++;
  const limit = isPriority ? PRIORITY_PER_MIN : DEFAULT_PER_MIN;
  return { ok: b.count <= limit, retryAfter: Math.max(1, Math.ceil((b.reset - now) / 1000)) };
}
