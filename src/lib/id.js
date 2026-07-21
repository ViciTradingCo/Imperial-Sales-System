/** A unique idempotency key for a submit, so retries can't double-apply. */
export function newIdem() {
  try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* fallback */ }
  return 'idem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
