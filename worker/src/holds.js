/**
 * The network-wide hold list, read from the Core's index_Holds_Master (the one
 * source of truth). Falls back to the classic nine if the Core is unreachable.
 */
import { readRange } from './sheets.js';
import { DEFAULT_HOLDS } from './ledger.js';

export async function readHolds(env) {
  try {
    const rows = await readRange(env, env.CORE_SPREADSHEET_ID, 'index_Holds_Master!A2:A');
    const holds = (rows || []).map((r) => String(r[0] || '').trim()).filter(Boolean);
    return holds.length ? holds : DEFAULT_HOLDS.slice();
  } catch (e) {
    return DEFAULT_HOLDS.slice();
  }
}
