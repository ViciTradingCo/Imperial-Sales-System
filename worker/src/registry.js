/**
 * The business registry (the Core's existing "Certified Users" sheet) plus the
 * registration logic that ties a person (Users row) to a business.
 *
 * Certified Users columns (unchanged from the Apps Script system):
 *   User ID | Point of Contact | Business Name | Subscription Valid Until |
 *   Perpetual | Status | Sync Status | Last Sync | Sync? | Last Wipe
 * where User ID IS the business's ledger document ID.
 *
 * Business NAME is the human key that links a Users row to its business, so we
 * enforce name uniqueness at registration.
 */
import { readRange, appendRows, updateRange, ensureSheet, ensureColumns } from './sheets.js';
import { appendUser, findUserByEmail, reconcileUsersHeader, USERS_SHEET, USERS_HEADERS } from './users.js';
import { renameBusinessKey } from './business-settings.js';
import { renameBusinessData } from './db.js';

export const CERT_SHEET = 'Certified Users';
// Hold (K) and Court (L) are appended after the classic Apps Script columns so
// existing rows never shift. Court is an admin-only flag; Hold is the Skyrim
// hold the business trades in, chosen at registration.
export const CERT_HEADERS = ['User ID', 'Point of Contact', 'Business Name', 'Subscription Valid Until', 'Perpetual', 'Status', 'Sync Status', 'Last Sync', 'Sync?', 'Last Wipe', 'Hold', 'Court'];

/** Widens the grid (if needed) and rewrites the Certified Users header row so a
 *  pre-existing 10-column tab gains the Hold/Court columns + labels. */
export async function reconcileCertHeader(env) {
  await ensureColumns(env, env.CORE_SPREADSHEET_ID, CERT_SHEET, CERT_HEADERS.length);
  await updateRange(env, env.CORE_SPREADSHEET_ID, `${CERT_SHEET}!A1`, [CERT_HEADERS]);
}

/** Short, collision-resistant application id. */
export function genUid(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/** Finds a business by name (case-insensitive). Returns { ledgerId, businessName, pointOfContact } or null. */
export async function findBusinessByName(env, name) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return null;
  let rows;
  try {
    rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${CERT_SHEET}!A2:C`);
  } catch (e) {
    if (/Unable to parse range|not found/i.test(e.message)) return null;
    throw e;
  }
  for (const r of rows) {
    if (String(r[2] || '').trim().toLowerCase() === target) {
      return { ledgerId: String(r[0] || '').trim(), businessName: String(r[2] || '').trim(), pointOfContact: String(r[1] || '').trim() };
    }
  }
  return null;
}

/** All active (non-archived) business names — for pickers like transfer targets. */
export async function listBusinessNames(env) {
  let rows;
  try {
    rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${CERT_SHEET}!A2:F`);
  } catch (e) {
    return [];
  }
  return rows
    .filter((r) => String(r[2] || '').trim() && String(r[5] || '').trim().toUpperCase() !== 'ARCHIVED')
    .map((r) => String(r[2]).trim());
}

/** Returns a business's Hold and Court flag from the registry ({ hold, court }). */
export async function findBusinessMeta(env, name) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return { hold: '', court: false };
  let rows;
  try {
    rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${CERT_SHEET}!A2:L`);
  } catch (e) {
    return { hold: '', court: false };
  }
  for (const r of rows) {
    if (String(r[2] || '').trim().toLowerCase() === target) {
      return { hold: String(r[10] || '').trim(), court: String(r[11]).trim().toUpperCase() === 'TRUE' };
    }
  }
  return { hold: '', court: false };
}

/** Appends a business row to Certified Users (subscription/sync columns left for the admin + sync to fill). */
async function appendBusiness(env, { ledgerId, businessName, pointOfContact, hold }) {
  await appendRows(env, env.CORE_SPREADSHEET_ID, `${CERT_SHEET}!A1`, [[
    ledgerId, pointOfContact || '', businessName, '', 'FALSE', '', '', '', 'FALSE', '', hold || '', 'FALSE',
  ]]);
}

/**
 * Registers the signed-in user. Idempotent: if they already exist, returns the
 * existing record. Otherwise:
 *   asOwner=true  → the business name must be FREE; we mint a ledger, add the
 *                   Certified Users row, and create an active owner.
 *   asOwner=false → the business name must ALREADY EXIST; we create a pending
 *                   employee awaiting owner/admin activation.
 */
export async function registerUser(env, { email, name, character, businessName, asOwner, hold }) {
  // Self-heal the registry tabs so a fresh Core needs nothing hand-created
  // beyond the Users tab (which seeds the first admin).
  await ensureSheet(env, env.CORE_SPREADSHEET_ID, USERS_SHEET, USERS_HEADERS);
  await reconcileUsersHeader(env); // adds the Character column to a pre-existing tab

  const existing = await findUserByEmail(env, email);
  if (existing) return { ...existing, alreadyRegistered: true };

  const char = String(character || '').trim();
  if (!char) throw new Error('Enter your character\'s name.');
  const biz = String(businessName || '').trim();
  if (!biz) throw new Error('A business name is required to register.');

  const found = await findBusinessByName(env, biz);

  if (asOwner) {
    if (found) {
      throw new Error('A business named "' + biz + '" is already registered. If you own it, ask an admin to link your account; otherwise choose a different name.');
    }
    await ensureSheet(env, env.CORE_SPREADSHEET_ID, CERT_SHEET, CERT_HEADERS);
    await reconcileCertHeader(env); // add the Hold/Court columns to a pre-existing tab
    // The business's ledger is LINKED later (Phase 3): the owner shares a Sheet
    // they own and its document ID replaces this placeholder in the User ID
    // column. Until then the business is keyed by this generated id.
    const businessId = genUid('biz');
    // Point of Contact is the owner's character (the in-character name).
    await appendBusiness(env, { ledgerId: businessId, businessName: biz, pointOfContact: char, hold: String(hold || '').trim() });
    const uid = genUid('usr');
    return appendUser(env, { uid, email, character: char, business: biz, role: 'owner', isOwner: true, status: 'active' });
  }

  // Employee path
  if (!found) {
    throw new Error('No business named "' + biz + '" is registered yet. Ask its owner to register it first, or register as its owner if it\'s yours.');
  }
  const uid = genUid('usr');
  return appendUser(env, { uid, email, character: char, business: found.businessName, role: 'employee', isOwner: false, status: 'pending' });
}

/**
 * Renames a business everywhere it's referenced (the business name is the key
 * linking the registry, users, and per-business settings): the Certified Users
 * row, every Users row in that business, and the Business Settings key.
 */
export async function renameBusiness(env, oldName, newName) {
  const old = String(oldName || '').trim();
  const nw = String(newName || '').trim();
  if (!nw) throw new Error('Enter a company name.');

  // Uniqueness — allow a case-only change of the SAME business, block colliding
  // with a different one.
  const clash = await findBusinessByName(env, nw);
  if (clash && clash.businessName.trim().toLowerCase() !== old.toLowerCase()) {
    throw new Error('A business named "' + nw + '" already exists.');
  }
  const lc = old.toLowerCase();

  const certRows = await readRange(env, env.CORE_SPREADSHEET_ID, `${CERT_SHEET}!A2:C`);
  for (let i = 0; i < certRows.length; i++) {
    if (String(certRows[i][2] || '').trim().toLowerCase() === lc) {
      await updateRange(env, env.CORE_SPREADSHEET_ID, `${CERT_SHEET}!C${i + 2}`, [[nw]]);
    }
  }

  const userRows = await readRange(env, env.CORE_SPREADSHEET_ID, `${USERS_SHEET}!A2:I`);
  for (let i = 0; i < userRows.length; i++) {
    if (String(userRows[i][2] || '').trim().toLowerCase() === lc) {
      await updateRange(env, env.CORE_SPREADSHEET_ID, `${USERS_SHEET}!C${i + 2}`, [[nw]]);
    }
  }

  await renameBusinessKey(env, old, nw);
  return nw;
}

function toDateStr(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function statusFromDate(untilStr) {
  const d = new Date(untilStr);
  if (isNaN(d.getTime())) return 'EXPIRED';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return d >= today ? 'VALID' : 'EXPIRED';
}

/** All registered companies (admin company list). */
export async function listCompanies(env) {
  let rows;
  try {
    rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${CERT_SHEET}!A2:L`);
  } catch (e) {
    return [];
  }
  return rows
    .filter((r) => (String(r[2] || '').trim() || String(r[0] || '').trim())
      && String(r[5] || '').trim().toUpperCase() !== 'ARCHIVED')
    .map((r) => ({
      id: String(r[0] || '').trim(),
      business: String(r[2] || '').trim(),
      pointOfContact: String(r[1] || '').trim(),
      until: toDateStr(r[3]),
      perpetual: String(r[4]).trim().toUpperCase() === 'TRUE',
      status: String(r[5] || '').trim(),
      hold: String(r[10] || '').trim(),
      court: String(r[11]).trim().toUpperCase() === 'TRUE',
    }));
}

/**
 * Admin edit of a company (targeted by its stable id = User ID / ledger id):
 * rename (propagated everywhere) and/or set the subscription expiry + Perpetual.
 */
export async function updateCompany(env, { id, name, until, perpetual, hold, court }) {
  const targetId = String(id || '').trim();
  if (!targetId) throw new Error('Missing company id.');
  // Ensure the Hold/Court columns exist before we read or write them.
  await reconcileCertHeader(env);
  const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${CERT_SHEET}!A2:L`);
  let rowIdx = null;
  let current = null;
  rows.forEach((r, i) => { if (String(r[0] || '').trim() === targetId) { rowIdx = i + 2; current = r; } });
  if (!rowIdx) throw new Error('Company not found.');

  const oldName = String(current[2] || '').trim();
  const newName = String(name || '').trim();
  if (!newName) throw new Error('Company name is required.');
  if (newName !== oldName) {
    await renameBusiness(env, oldName, newName);
    await renameBusinessData(env, oldName, newName);
  }

  const perp = !!perpetual;
  const untilStr = perp ? '' : String(until || '').trim();
  const status = perp ? 'VALID' : statusFromDate(untilStr);
  await updateRange(env, env.CORE_SPREADSHEET_ID, `${CERT_SHEET}!D${rowIdx}:F${rowIdx}`,
    [[untilStr, perp ? 'TRUE' : 'FALSE', status]]);

  // Hold (K) and the admin-only Court flag (L). Preserve either if not supplied.
  const holdStr = hold === undefined ? String(current[10] || '').trim() : String(hold || '').trim();
  const courtBool = court === undefined ? String(current[11]).trim().toUpperCase() === 'TRUE' : !!court;
  await updateRange(env, env.CORE_SPREADSHEET_ID, `${CERT_SHEET}!K${rowIdx}:L${rowIdx}`,
    [[holdStr, courtBool ? 'TRUE' : 'FALSE']]);

  return listCompanies(env);
}

/**
 * Archives (the delete action) a company. Its market data is RETAINED for
 * analysis but moved out of reach of any future company: we rename the business
 * — and all its records — to a unique archived key, mark the registry row
 * ARCHIVED, and free the original name for re-use. Because the name is freed and
 * the archived row is filtered out of the company list, a remade company starts
 * clean and can never pull the archived company's history.
 */
export async function archiveCompany(env, id) {
  const targetId = String(id || '').trim();
  if (!targetId) throw new Error('Missing company id.');
  const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${CERT_SHEET}!A2:L`);
  let rowIdx = null;
  let current = null;
  rows.forEach((r, i) => { if (String(r[0] || '').trim() === targetId) { rowIdx = i + 2; current = r; } });
  if (!rowIdx) throw new Error('Company not found.');

  const oldName = String(current[2] || '').trim();
  if (String(current[5] || '').trim().toUpperCase() === 'ARCHIVED') return listCompanies(env);
  const archivedName = oldName + ' [archived ' + Date.now().toString(36) + ']';

  // Move the name everywhere (registry row, Users rows, settings key) and in D1
  // (inventory/sales/intake), so the data survives under the archived key.
  await renameBusiness(env, oldName, archivedName);
  await renameBusinessData(env, oldName, archivedName);

  // Flag the (now renamed) row ARCHIVED and stop it syncing.
  await updateRange(env, env.CORE_SPREADSHEET_ID, `${CERT_SHEET}!F${rowIdx}`, [['ARCHIVED']]);
  await updateRange(env, env.CORE_SPREADSHEET_ID, `${CERT_SHEET}!I${rowIdx}`, [['FALSE']]);

  return listCompanies(env);
}
