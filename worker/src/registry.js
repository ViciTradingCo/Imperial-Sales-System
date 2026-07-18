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
import { readRange, appendRows, ensureSheet } from './sheets.js';
import { appendUser, findUserByEmail, reconcileUsersHeader, USERS_SHEET, USERS_HEADERS } from './users.js';

export const CERT_SHEET = 'Certified Users';
export const CERT_HEADERS = ['User ID', 'Point of Contact', 'Business Name', 'Subscription Valid Until', 'Perpetual', 'Status', 'Sync Status', 'Last Sync', 'Sync?', 'Last Wipe'];

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

/** Appends a business row to Certified Users (subscription/sync columns left for the admin + sync to fill). */
async function appendBusiness(env, { ledgerId, businessName, pointOfContact }) {
  await appendRows(env, env.CORE_SPREADSHEET_ID, `${CERT_SHEET}!A1`, [[
    ledgerId, pointOfContact || '', businessName, '', 'FALSE', '', '', '', 'FALSE', '',
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
export async function registerUser(env, { email, name, character, businessName, asOwner }) {
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
    // The business's ledger is LINKED later (Phase 3): the owner shares a Sheet
    // they own and its document ID replaces this placeholder in the User ID
    // column. Until then the business is keyed by this generated id.
    const businessId = genUid('biz');
    // Point of Contact is the owner's character (the in-fiction name).
    await appendBusiness(env, { ledgerId: businessId, businessName: biz, pointOfContact: char });
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
