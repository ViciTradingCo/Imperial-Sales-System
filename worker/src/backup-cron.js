/**
 * Scheduled off-site backup. On the Worker's cron trigger, dump a full gzipped
 * D1 snapshot to an R2 bucket (binding `BACKUPS`), then prune to the most recent
 * BACKUP_KEEP snapshots. Entirely optional: a no-op if no R2 bucket is bound.
 *
 * R2 is off-platform durable object storage in the same account — a real safety
 * net beyond the admin's manual file exports and D1's own Time Travel.
 */
import { collectExport, gzipJson } from './export.js';

const PREFIX = 'backups/';
const DEFAULT_KEEP = 14;

export async function runScheduledBackup(env) {
  if (!env.BACKUPS) return { skipped: 'no R2 bucket bound' };
  const buf = await gzipJson(await collectExport(env));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const key = PREFIX + 'eec-backup-' + stamp + '.json.gz';
  await env.BACKUPS.put(key, buf, { httpMetadata: { contentType: 'application/gzip' } });

  // Prune old snapshots beyond the retention count (newest kept).
  const keep = Math.max(1, Number(env.BACKUP_KEEP) || DEFAULT_KEEP);
  const listing = await env.BACKUPS.list({ prefix: PREFIX });
  const objs = (listing.objects || []).slice().sort((a, b) => (a.key < b.key ? 1 : -1)); // newest first (ISO key sorts lexically)
  const stale = objs.slice(keep);
  for (const o of stale) await env.BACKUPS.delete(o.key);
  return { key, kept: Math.min(objs.length, keep), pruned: stale.length };
}
