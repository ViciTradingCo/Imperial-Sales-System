/**
 * Ledger constants shared across the backend.
 *
 * The original Apps Script system minted a per-shop Google Sheets ledger on
 * registration; the port dropped that (a service account on a personal project
 * can't create Drive files, and D1 is now the transactional store), so the
 * provisioning code was removed. The classic nine holds remain here as the
 * fallback for the Core's hold index (see holds.js).
 */
export const DEFAULT_HOLDS = ['Eastmarch', 'Falkreath', 'Haafingar', 'Hjaalmarch', 'The Pale', 'The Reach', 'The Rift', 'Whiterun', 'Winterhold'];
