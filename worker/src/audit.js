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

export async function listAudit(env, limit = 150) {
  const db = await getDb(env);
  const { results } = await db.prepare(
    'SELECT ts, actor, actor_business, action, detail FROM audit ORDER BY id DESC LIMIT ?').bind(limit).all();
  return results || [];
}
