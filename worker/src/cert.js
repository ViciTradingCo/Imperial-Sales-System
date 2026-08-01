/**
 * Vici Trading Co. certification check for a business. Read from the D1 `companies`
 * registry: Perpetual grants VALID forever; otherwise VALID while today ≤ the
 * subscription `until` date, EXPIRED beyond it (a blank/unreadable date — or a
 * business not in the registry — is EXPIRED).
 */
import { getDb } from './db.js';
import { cacheGet, cacheSet } from './cache.js';

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function checkCertification(env, business, realmId) {
  const target = String(business || '').trim().toLowerCase();
  if (!target) return { status: 'EXPIRED', until: '' };
  const cached = await cacheGet(env, 'cert:' + target);
  if (cached) return cached;
  const put = async (r) => { await cacheSet(env, 'cert:' + target, r, 30000); return r; };

  let row;
  try {
    const db = await getDb(env);
    row = await db.prepare('SELECT perpetual, until FROM companies WHERE realm_id = ? AND lower(business) = ?')
      .bind(realmId, target).first();
  } catch (e) {
    return { status: 'EXPIRED', until: '', error: 'Could not read the registry.' }; // transient — not cached
  }
  if (!row) return put({ status: 'EXPIRED', until: '' }); // business not certified yet
  if (Number(row.perpetual) === 1) return put({ status: 'VALID', perpetual: true });
  const d = new Date(String(row.until || ''));
  if (isNaN(d.getTime())) return put({ status: 'EXPIRED', until: '' });
  d.setHours(0, 0, 0, 0);
  const until = d.toISOString().slice(0, 10);
  return put({ status: d >= startOfToday() ? 'VALID' : 'EXPIRED', until });
}
