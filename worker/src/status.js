/** A quick D1 health snapshot for the admin System Status panel. */
import { getDb } from './db.js';

const TABLES = ['inventory', 'sales', 'intake', 'transfers', 'coffer_entries',
  'discounts', 'master_item', 'hold_index', 'audit'];

export async function systemStatus(env) {
  const db = await getDb(env);
  const counts = {};
  for (const t of TABLES) {
    const r = await db.prepare('SELECT COUNT(*) AS n FROM ' + t).first();
    counts[t] = r ? r.n : 0;
  }
  const lastSale = await db.prepare("SELECT ts FROM sales ORDER BY id DESC LIMIT 1").first();
  const lastAudit = await db.prepare('SELECT ts FROM audit ORDER BY id DESC LIMIT 1').first();
  return { counts, lastSale: lastSale ? lastSale.ts : null, lastAudit: lastAudit ? lastAudit.ts : null };
}
