/**
 * Vici Trading Co. certification check for a business. Read from the D1 `companies`
 * registry: Perpetual grants VALID forever; otherwise VALID while today ≤ the
 * subscription `until` date, EXPIRED beyond it (a blank/unreadable date — or a
 * business not in the registry — is EXPIRED).
 *
 * A REALM MAY NOT REQUIRE IT AT ALL (`realm-prefs.certification`). Then this
 * passes every shop that exists and is not archived, and says so with `off`, so
 * the screens that manage subscriptions can stop asking rather than showing a
 * VALID badge over a date nobody maintains. The stored dates are untouched:
 * turning it back on restores each shop's real standing instead of having
 * quietly certified the lot.
 */
import { getDb } from './db.js';
import { cacheGet, cacheSet } from './cache.js';
import { readRealmPrefs } from './realm-prefs.js';

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function checkCertification(env, business, realmId) {
  const target = String(business || '').trim().toLowerCase();
  if (!target) return { status: 'EXPIRED', until: '' };
  // The realm belongs in the KEY. Without it two realms holding a shop of the
  // same name shared one cached answer, so one realm's expiry decided whether
  // the other could sell — for up to 30 seconds, intermittently, which is the
  // worst kind of bug to chase.
  const key = 'cert:' + String(realmId || 'default') + ':' + target;
  const cached = await cacheGet(env, key);
  if (cached) return cached;
  const put = async (r) => { await cacheSet(env, key, r, 30000); return r; };

  let row;
  try {
    const db = await getDb(env);
    row = await db.prepare('SELECT perpetual, until, status FROM companies WHERE realm_id = ? AND lower(business) = ?')
      .bind(realmId, target).first();
  } catch (e) {
    return { status: 'EXPIRED', until: '', error: 'Could not read the registry.' }; // transient — not cached
  }
  if (!row) return put({ status: 'EXPIRED', until: '' }); // business not certified yet
  // AN ARCHIVED SHOP DOES NOT TRADE, whatever its certification says. This is
  // checked BEFORE perpetual, which is the whole point: a perpetual shop that
  // was archived kept returning VALID, so its staff could still ring up sales
  // against a company that had left the network.
  if (String(row.status || '').trim().toUpperCase() === 'ARCHIVED') {
    return put({ status: 'EXPIRED', until: '', archived: true });
  }
  // The realm does not require certification: a shop that EXISTS and has not
  // been archived may trade. Read after the row for exactly that reason — this
  // is a rule about expiry dates, not a way for a company nobody registered to
  // start selling.
  const prefs = await readRealmPrefs(env, realmId);
  if (prefs.certification === false) return put({ status: 'VALID', off: true });
  if (Number(row.perpetual) === 1) return put({ status: 'VALID', perpetual: true });
  const d = new Date(String(row.until || ''));
  if (isNaN(d.getTime())) return put({ status: 'EXPIRED', until: '' });
  d.setHours(0, 0, 0, 0);
  const until = d.toISOString().slice(0, 10);
  return put({ status: d >= startOfToday() ? 'VALID' : 'EXPIRED', until });
}
