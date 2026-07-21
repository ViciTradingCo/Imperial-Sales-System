/**
 * East Empire certification check for a business. Read live from the Core's
 * Certified Users registry: Perpetual grants VALID forever; otherwise VALID
 * while today ≤ the Subscription Valid Until date, EXPIRED beyond it (a blank or
 * unreadable date — or a business not in the registry — is EXPIRED).
 *
 * Certified Users columns: User ID | Point of Contact | Business Name |
 * Subscription Valid Until | Perpetual | Status | ...
 */
import { readRange } from './sheets.js';
import { cacheGet, cacheSet } from './cache.js';

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function checkCertification(env, business) {
  const target = String(business || '').trim().toLowerCase();
  if (!target) return { status: 'EXPIRED', until: '' };
  const cached = cacheGet('cert:' + target);
  if (cached) return cached;
  let rows;
  try {
    rows = await readRange(env, env.CORE_SPREADSHEET_ID, 'Certified Users!A2:E');
  } catch (e) {
    return { status: 'EXPIRED', until: '', error: 'Could not read the registry.' }; // transient — not cached
  }
  const put = (r) => { cacheSet('cert:' + target, r, 30000); return r; };
  for (const r of rows) {
    if (String(r[2] || '').trim().toLowerCase() !== target) continue;
    const perpetual = String(r[4]).trim().toUpperCase() === 'TRUE';
    if (perpetual) return put({ status: 'VALID', perpetual: true });
    const raw = r[3];
    const d = raw instanceof Date ? new Date(raw.getTime()) : new Date(String(raw));
    if (isNaN(d.getTime())) return put({ status: 'EXPIRED', until: '' });
    d.setHours(0, 0, 0, 0);
    const until = d.toISOString().slice(0, 10);
    return put({ status: d >= startOfToday() ? 'VALID' : 'EXPIRED', until });
  }
  return put({ status: 'EXPIRED', until: '' }); // business not certified yet
}
