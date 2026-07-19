/**
 * Scheduled backup — mirrors the live D1 transactional store (sales, intake,
 * inventory) into a Google Sheet the operator controls, on a slow cadence (a
 * Cron Trigger; see wrangler.toml [triggers]). D1 stays the source of truth for
 * the app; this is a human-readable, operator-owned copy for safekeeping and
 * off-platform analysis.
 *
 * Target: env.BACKUP_SPREADSHEET_ID (a separate Sheet, shared with edit access
 * to the service account). If it's not set the backup is a no-op, so the app
 * runs fine without one.
 *
 * Each run is a FULL MIRROR: the tab's data region is cleared and rewritten from
 * the current D1 snapshot, so voids/edits/deletes are reflected and the Sheet
 * never drifts from D1. At this scale that's a handful of Sheets writes.
 */
import { ensureSheet, updateRange, clearRange } from './sheets.js';
import { ensureSchema } from './db.js';

// Each table: the tab name, the D1 columns to pull (in order), and the human
// header row. Column order drives both the SELECT and the written rows.
const TABLES = [
  {
    tab: 'Backup_Sales',
    cols: ['id', 'business', 'ts', 'order_no', 'customer', 'hold', 'items', 'qty_total', 'total', 'employee', 'discount', 'status'],
    headers: ['ID', 'Business', 'Timestamp', 'Order #', 'Customer', 'Hold', 'Items', 'Qty', 'Total', 'Employee', 'Discount', 'Status'],
  },
  {
    tab: 'Backup_Intake',
    cols: ['id', 'business', 'ts', 'item', 'vendor', 'source_hold', 'num_items', 'price_per'],
    headers: ['ID', 'Business', 'Timestamp', 'Item', 'Vendor', 'Source Hold', 'Num Items', 'Price Per'],
  },
  {
    tab: 'Backup_Inventory',
    cols: ['id', 'business', 'item', 'price', 'stock', 'low_stock'],
    headers: ['ID', 'Business', 'Item', 'Price', 'Stock', 'Low Stock'],
  },
];

const META_TAB = 'Backup_Meta';
const META_HEADERS = ['Last Backup (UTC)', 'Sales Rows', 'Intake Rows', 'Inventory Rows'];

/**
 * Runs one backup pass. Returns a small summary; never throws for the "not
 * configured" cases so the caller (cron or admin button) can report cleanly.
 */
export async function runBackup(env) {
  const target = String(env.BACKUP_SPREADSHEET_ID || '').trim();
  if (!target) return { ok: false, skipped: 'No BACKUP_SPREADSHEET_ID is configured.' };
  if (!env.DB) return { ok: false, skipped: 'The D1 database is not connected.' };

  await ensureSchema(env);
  const counts = {};

  for (const t of TABLES) {
    await ensureSheet(env, target, t.tab, t.headers);
    // Keep the header row current even on a pre-existing tab.
    await updateRange(env, target, `${t.tab}!A1`, [t.headers]);

    const sql = `SELECT ${t.cols.join(', ')} FROM ${t.tab.replace('Backup_', '').toLowerCase()} ORDER BY id`;
    const { results } = await env.DB.prepare(sql).all();
    const rows = (results || []).map((r) => t.cols.map((c) => (r[c] == null ? '' : r[c])));

    // Clear the old data region, then write the fresh snapshot below the header.
    await clearRange(env, target, `${t.tab}!A2:Z`);
    if (rows.length) await updateRange(env, target, `${t.tab}!A2`, rows);
    counts[t.tab] = rows.length;
  }

  await ensureSheet(env, target, META_TAB, META_HEADERS);
  const at = new Date().toISOString();
  await updateRange(env, target, `${META_TAB}!A1`, [META_HEADERS]);
  await updateRange(env, target, `${META_TAB}!A2`, [[
    at, counts.Backup_Sales || 0, counts.Backup_Intake || 0, counts.Backup_Inventory || 0,
  ]]);

  return {
    ok: true,
    at,
    sales: counts.Backup_Sales || 0,
    intake: counts.Backup_Intake || 0,
    inventory: counts.Backup_Inventory || 0,
  };
}
