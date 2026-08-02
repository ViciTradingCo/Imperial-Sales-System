/**
 * Scheduled off-site backup. On the Worker's cron trigger, dump gzipped D1
 * snapshots to an R2 bucket (binding `BACKUPS`), then prune to the most recent
 * BACKUP_KEEP per stream. Entirely optional: a no-op if no R2 bucket is bound.
 *
 * R2 is off-platform durable object storage in the same account — a real safety
 * net beyond the admin's manual file exports and D1's own Time Travel.
 *
 * TWO STREAMS, because restoring is where realms matter:
 *   backups/all/…            — the whole deployment, for total loss.
 *   backups/realm/<id>/…     — one realm, so recovering one server cannot drag
 *                              the others back in time with it.
 * Each stream is pruned independently, so a realm's history isn't evicted by the
 * deployment-wide snapshots or by another realm's.
 */
import { collectExport, gzipJson } from './export.js';
import { listRealms } from './realm.js';

const PREFIX = 'backups/';
const DEFAULT_KEEP = 14;

/** Writes one snapshot and prunes that stream to `keep` newest. */
async function snapshot(env, prefix, realmId, stamp, keep) {
  const buf = await gzipJson(await collectExport(env, realmId));
  const key = prefix + 'vici-backup-' + stamp + '.json.gz';
  await env.BACKUPS.put(key, buf, { httpMetadata: { contentType: 'application/gzip' } });

  const listing = await env.BACKUPS.list({ prefix });
  // Newest first — the ISO stamp in the key sorts lexically.
  const objs = (listing.objects || []).slice().sort((a, b) => (a.key < b.key ? 1 : -1));
  const stale = objs.slice(keep);
  for (const o of stale) await env.BACKUPS.delete(o.key);
  return { key, pruned: stale.length };
}

export async function runScheduledBackup(env) {
  if (!env.BACKUPS) return { skipped: 'no R2 bucket bound' };
  const keep = Math.max(1, Number(env.BACKUP_KEEP) || DEFAULT_KEEP);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  const written = [];
  written.push(await snapshot(env, PREFIX + 'all/', '', stamp, keep));
  // One per realm. A single-realm deployment costs one extra small object.
  for (const r of await listRealms(env)) {
    written.push(await snapshot(env, PREFIX + 'realm/' + r.id + '/', r.id, stamp, keep));
  }
  return { snapshots: written.length, keys: written.map((w) => w.key), pruned: written.reduce((n, w) => n + w.pruned, 0) };
}
