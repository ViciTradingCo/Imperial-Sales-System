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
import { cacheGet, cacheSet, cacheBust } from './cache.js';

export const USERS_SHEET = 'Users';
// Character (I) and owner Notes (J) are appended at the end so existing
// rows/headers never shift.
export const USERS_HEADERS = ['UID', 'Email', 'Business', 'Role', 'Is Owner', 'Status', 'Created', 'Last Seen', 'Character', 'Notes'];

function normalizeRow(r) {
  return {
    uid: String(r[0] || '').trim(),
    email: String(r[1] || '').trim(),
    business: String(r[2] || '').trim(),
    role: String(r[3] || '').trim().toLowerCase() || 'employee',
    isOwner: String(r[4]).trim().toUpperCase() === 'TRUE',
    status: String(r[5] || '').trim().toLowerCase() || 'active',
    character: String(r[8] || '').trim(),
    notes: String(r[9] || '').trim(),
  };
}

/**
 * Looks up a user by verified email. Returns a normalized record or null when
 * the email is not registered.
 */
export async function findUserByEmail(env, email) {
  const target = String(email || '').trim().toLowerCase();
  if (!target) return null;
  // Positive-only cache: a hit is a registered user; misses are never cached
  // so a just-registered account is found immediately.
  const cached = await cacheGet(env, 'user:' + target);
  if (cached) return { ...cached };
  let rows;
  try {
    rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${USERS_SHEET}!A2:J`);
  } catch (e) {
    // A missing Users tab is an expected pre-registration state, not a crash.
    if (/Unable to parse range|not found/i.test(e.message)) return null;
    throw e;
  }
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][1] || '').trim().toLowerCase() === target) {
      const user = normalizeRow(rows[i]);
      user.row = i + 2; // 1-based sheet row (data starts at row 2)
      await cacheSet(env, 'user:' + target, user, 15000);
      return { ...user };
    }
  }
  return null;
}

/** Invalidates the cached identity for any Users write. */
export function bustUserCache() { cacheBust('user:'); }

/** Every user in the system (admin member list). */
export async function listAllUsers(env) {
  const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${USERS_SHEET}!A2:I`);
  return rows
    .filter((r) => String(r[0] || '').trim() || String(r[1] || '').trim())
    .map((r) => {
      const u = normalizeRow(r);
      return { uid: u.uid, email: u.email, character: u.character, business: u.business, role: u.role, isOwner: u.isOwner, status: u.status };
    });
}

/** Every user belonging to a business (case-insensitive match on the name). */
export async function listUsersByBusiness(env, business) {
  const target = String(business || '').trim().toLowerCase();
  if (!target) return [];
  const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${USERS_SHEET}!A2:J`);
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
  bustUserCache();
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
  bustUserCache();
}

/** Sets a user's Character cell (column I) by sheet row. */
export async function setUserCharacter(env, row, character) {
  await updateRange(env, env.CORE_SPREADSHEET_ID, `${USERS_SHEET}!I${row}`, [[character]]);
  bustUserCache();
}

/** Sets a user's owner-only Notes cell (column J) by sheet row. */
export async function setUserNote(env, row, note) {
  await updateRange(env, env.CORE_SPREADSHEET_ID, `${USERS_SHEET}!J${row}`, [[String(note || '').trim()]]);
  bustUserCache();
}

/** Admin edit of a member (by UID): character, company, and role. */
export async function updateMember(env, { uid, character, business, role }) {
  const target = String(uid || '').trim();
  if (!target) throw new Error('Missing member uid.');
  const r = String(role || '').trim().toLowerCase();
  if (!['admin', 'owner', 'employee'].includes(r)) throw new Error('Role must be admin, owner, or employee.');

  const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${USERS_SHEET}!A2:I`);
  let rowIdx = null;
  rows.forEach((row, i) => { if (String(row[0] || '').trim() === target) rowIdx = i + 2; });
  if (!rowIdx) throw new Error('Member not found.');

  // Business | Role | Is Owner  (C,D,E), then Character (I) — leave status/dates alone.
  await updateRange(env, env.CORE_SPREADSHEET_ID, `${USERS_SHEET}!C${rowIdx}:E${rowIdx}`,
    [[String(business || '').trim(), r, r === 'owner' ? 'TRUE' : 'FALSE']]);
  await updateRange(env, env.CORE_SPREADSHEET_ID, `${USERS_SHEET}!I${rowIdx}`,
    [[String(character || '').trim()]]);
  bustUserCache();
}

/**
 * Admin delete of a member (by UID). Clears the row's cells rather than
 * removing the row (no sheet-structure edit needed); listAllUsers/findUserByEmail
 * skip blank rows, so the member disappears and can register again fresh.
 */
export async function deleteMember(env, uid) {
  const target = String(uid || '').trim();
  if (!target) throw new Error('Missing member uid.');
  const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${USERS_SHEET}!A2:I`);
  let rowIdx = null;
  rows.forEach((row, i) => { if (String(row[0] || '').trim() === target) rowIdx = i + 2; });
  if (!rowIdx) throw new Error('Member not found.');
  await updateRange(env, env.CORE_SPREADSHEET_ID, `${USERS_SHEET}!A${rowIdx}:J${rowIdx}`,
    [['', '', '', '', '', '', '', '', '', '']]);
  bustUserCache();
}

/** Best-effort Last Seen stamp (column H). Never throws into the caller. */
export async function touchLastSeen(env, row) {
  try {
    await updateRange(env, env.CORE_SPREADSHEET_ID, `${USERS_SHEET}!H${row}`, [[new Date().toISOString()]]);
  } catch (e) { /* non-critical */ }
}
