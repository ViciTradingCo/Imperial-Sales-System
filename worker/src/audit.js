/** Audit trail (D1) of significant admin/owner actions. Best-effort — logging
 *  never breaks the action it records. */
import { getDb } from './db.js';

export async function logAudit(env, { actor, business, action, detail }) {
  try {
    const db = await getDb(env);
    await db.prepare('INSERT INTO audit (ts, actor, actor_business, action, detail) VALUES (?, ?, ?, ?, ?)')
      .bind(new Date().toISOString(), String(actor || ''), String(business || ''), String(action || ''), String(detail || '')).run();
  } catch (e) { /* audit is best-effort; never throw into the caller */ }
}

/**
 * Recent audit entries, newest first. Optional filters narrow the trail:
 *   actor  — substring match on who did it
 *   action — exact action key (e.g. 'sale.void') or a prefix ('sale.')
 *   from/to — ISO dates (inclusive) bounding the timestamp
 * The log is append-only and grows fast, so filtering happens in SQL.
 */
export async function listAudit(env, { limit = 150, actor, action, from, to } = {}) {
  const db = await getDb(env);
  const where = [];
  const binds = [];
  const a = String(actor || '').trim().toLowerCase();
  if (a) { where.push('lower(actor) LIKE ?'); binds.push('%' + a + '%'); }
  const act = String(action || '').trim().toLowerCase();
  if (act) {
    if (act.endsWith('.')) { where.push('lower(action) LIKE ?'); binds.push(act + '%'); }
    else { where.push('lower(action) = ?'); binds.push(act); }
  }
  const f = String(from || '').trim();
  if (f) { where.push('ts >= ?'); binds.push(f); }
  const t = String(to || '').trim();
  if (t) { where.push('ts <= ?'); binds.push(t + 'T23:59:59.999Z'); }

  const sql = 'SELECT ts, actor, actor_business, action, detail FROM audit'
    + (where.length ? ' WHERE ' + where.join(' AND ') : '')
    + ' ORDER BY id DESC LIMIT ?';
  binds.push(Math.min(500, Math.max(1, Number(limit) || 150)));
  const { results } = await db.prepare(sql).bind(...binds).all();
  return results || [];
}

/** The distinct action keys present in the log — powers the filter dropdown. */
export async function listAuditActions(env) {
  const db = await getDb(env);
  const { results } = await db.prepare('SELECT DISTINCT action FROM audit ORDER BY action').all();
  return (results || []).map((r) => r.action).filter(Boolean);
}
