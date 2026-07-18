/**
 * The Users registry — a new sheet in the EEC Core that maps a verified Google
 * email to an application identity (UID), a business, and a role. This is the
 * source of truth for authorization; every request resolves the caller here.
 *
 *   Users sheet columns:
 *   UID | Email | Business | Role | Is Owner | Status | Created | Last Seen
 *
 * Roles: 'admin' | 'owner' | 'employee'. Status: 'active' | 'pending'.
 * The first admin is seeded by hand (see docs/SETUP.md); registration (Phase 2)
 * writes the rest.
 */
import { readRange } from './sheets.js';

export const USERS_SHEET = 'Users';
export const USERS_HEADERS = ['UID', 'Email', 'Business', 'Role', 'Is Owner', 'Status', 'Created', 'Last Seen'];

/**
 * Looks up a user by verified email. Returns a normalized record or null when
 * the email is not registered.
 */
export async function findUserByEmail(env, email) {
  const target = String(email || '').trim().toLowerCase();
  if (!target) return null;
  let rows;
  try {
    rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${USERS_SHEET}!A2:H`);
  } catch (e) {
    // A missing Users tab is an expected pre-registration state, not a crash.
    if (/Unable to parse range|not found/i.test(e.message)) return null;
    throw e;
  }
  for (const r of rows) {
    if (String(r[1] || '').trim().toLowerCase() === target) {
      return {
        uid: String(r[0] || '').trim(),
        email: String(r[1] || '').trim(),
        business: String(r[2] || '').trim(),
        role: String(r[3] || '').trim().toLowerCase() || 'employee',
        isOwner: String(r[4]).trim().toUpperCase() === 'TRUE',
        status: String(r[5] || '').trim().toLowerCase() || 'active',
      };
    }
  }
  return null;
}
