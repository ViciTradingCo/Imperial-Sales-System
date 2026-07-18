/**
 * The Users registry — a new sheet in the EEC Core that maps a verified Google
 * email to an application identity (UID), a business, and a role. This is the
 * source of truth for authorization; every request resolves the caller here.
 *
 *   Users sheet columns:
 *   UID | Email | Business | Role | Is Owner | Status | Created | Last Seen | Character
 *
 * Roles: 'admin' | 'owner' | 'employee'. Status: 'active' | 'pending'.
 * The first admin is seeded by hand (see docs/SETUP.md); registration (Phase 2)
 * writes the rest.
 */
import { readRange, appendRows, updateRange } from './sheets.js';

export const USERS_SHEET = 'Users';
// Character is appended at the end so existing rows/headers never shift.
export const USERS_HEADERS = ['UID', 'Email', 'Business', 'Role', 'Is Owner', 'Status', 'Created', 'Last Seen', 'Character'];

function normalizeRow(r) {
  return {
    uid: String(r[0] || '').trim(),
    email: String(r[1] || '').trim(),
    business: String(r[2] || '').trim(),
    role: String(r[3] || '').trim().toLowerCase() || 'employee',
    isOwner: String(r[4]).trim().toUpperCase() === 'TRUE',
    status: String(r[5] || '').trim().toLowerCase() || 'active',
    character: String(r[8] || '').trim(),
  };
}

/**
 * Looks up a user by verified email. Returns a normalized record or null when
 * the email is not registered.
 */
export async function findUserByEmail(env, email) {
  const target = String(email || '').trim().toLowerCase();
  if (!target) return null;
  let rows;
  try {
    rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${USERS_SHEET}!A2:I`);
  } catch (e) {
    // A missing Users tab is an expected pre-registration state, not a crash.
    if (/Unable to parse range|not found/i.test(e.message)) return null;
    throw e;
  }
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][1] || '').trim().toLowerCase() === target) {
      const user = normalizeRow(rows[i]);
      user.row = i + 2; // 1-based sheet row (data starts at row 2)
      return user;
    }
  }
  return null;
}

/** Every user belonging to a business (case-insensitive match on the name). */
export async function listUsersByBusiness(env, business) {
  const target = String(business || '').trim().toLowerCase();
  if (!target) return [];
  const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${USERS_SHEET}!A2:I`);
  const out = [];
  rows.forEach((r, i) => {
    if (String(r[2] || '').trim().toLowerCase() === target) {
      const u = normalizeRow(r);
      u.row = i + 2;
      out.push(u);
    }
  });
  return out;
}

/** Appends a new user row. Returns the written record. */
export async function appendUser(env, { uid, email, business, role, isOwner, status, character }) {
  const now = new Date().toISOString();
  await appendRows(env, env.CORE_SPREADSHEET_ID, `${USERS_SHEET}!A1`, [[
    uid, email, business, role, isOwner ? 'TRUE' : 'FALSE', status, now, now, character || '',
  ]]);
  return { uid, email, business, role, isOwner: !!isOwner, status, character: character || '' };
}

/** Ensures the Users header row carries every current column (adds Character to
 *  a tab created before that column existed). Idempotent; safe on every run. */
export async function reconcileUsersHeader(env) {
  await updateRange(env, env.CORE_SPREADSHEET_ID, `${USERS_SHEET}!A1`, [USERS_HEADERS]);
}

/** Sets a user's Status cell (column F) by sheet row. */
export async function setUserStatus(env, row, status) {
  await updateRange(env, env.CORE_SPREADSHEET_ID, `${USERS_SHEET}!F${row}`, [[status]]);
}

/** Best-effort Last Seen stamp (column H). Never throws into the caller. */
export async function touchLastSeen(env, row) {
  try {
    await updateRange(env, env.CORE_SPREADSHEET_ID, `${USERS_SHEET}!H${row}`, [[new Date().toISOString()]]);
  } catch (e) { /* non-critical */ }
}
