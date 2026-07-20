/**
 * EEC Sales System — backend API (Cloudflare Worker).
 *
 * This is THE trust boundary. It:
 *   • verifies the caller's Google ID token (verify.js),
 *   • resolves them to a UID / role / business in the Core (users.js),
 *   • reads/writes Google Sheets as the service account (sheets.js),
 *   • returns only what that caller is allowed to see.
 *
 * Phase 1 surface:
 *   GET  /health     — liveness + config sanity (no auth)
 *   POST /auth/me    — verify token, return registry identity (or registered:false)
 *
 * Later phases add the role-scoped data routes. Authorization for those lives
 * HERE, never in the browser.
 *
 * Secrets (via `wrangler secret put`): SA_KEY (service-account JSON).
 * Vars (wrangler.toml [vars] or dashboard): CORE_SPREADSHEET_ID,
 *   GOOGLE_CLIENT_ID, ALLOWED_ORIGIN.
 */
import { verifyIdToken } from './verify.js';
import { findUserByEmail, listUsersByBusiness, listAllUsers, updateMember, deleteMember, setUserStatus, setUserCharacter, setUserNote, touchLastSeen, USERS_SHEET } from './users.js';
import { registerUser, renameBusiness, listCompanies, updateCompany, archiveCompany } from './registry.js';
import { readRange } from './sheets.js';
import { readSettings, writeSettings } from './settings.js';
import { readBusinessSettings, writeBusinessSettings } from './business-settings.js';
import { listInventory, upsertItem, deleteItem } from './inventory.js';
import { recordIntake, listIntake } from './intake.js';
import { readHolds } from './holds.js';
import { checkCertification } from './cert.js';
import { checkout, listSales, voidSale } from './sales.js';
import { renameBusinessData, ensureSchema } from './db.js';
import { runBackup } from './backup.js';
import { marketAnalysis } from './market.js';

function corsHeaders(env, request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Echo the origin when it's on the allow-list; fall back to the first
  // configured origin so a misconfigured ALLOWED_ORIGIN fails visibly.
  const allowOrigin = allowed.includes(origin) ? origin : (allowed[0] || '*');
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

/** Parses a JSON request body sent as text/plain (our CORS-preflight-free shape). */
async function readJsonBody(request) {
  const text = await request.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch (e) { throw new Error('Request body was not valid JSON.'); }
}

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
  });
}

/** Verifies the Bearer ID token on a request; returns the decoded payload or throws. */
async function requireUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new Error('Missing bearer token.');
  return verifyIdToken(m[1], env.GOOGLE_CLIENT_ID);
}

/** Shapes a Users record for the client (never leaks sheet internals like row #). */
function publicUser(user, extra) {
  return {
    registered: true,
    uid: user.uid,
    email: user.email,
    character: user.character || '',
    business: user.business,
    role: user.role,
    isOwner: user.isOwner,
    status: user.status,
    ...(extra || {}),
  };
}

/** Verifies the token AND requires the caller to be a registered user. */
async function requireRegistered(request, env) {
  const payload = await requireUser(request, env);
  const user = await findUserByEmail(env, payload.email);
  if (!user) {
    const err = new Error('You are not registered yet.');
    err.notRegistered = true;
    err.payload = payload;
    throw err;
  }
  return user;
}

async function handleMe(request, env) {
  const payload = await requireUser(request, env);
  const user = await findUserByEmail(env, payload.email);
  if (!user) {
    return { registered: false, email: payload.email, name: payload.name || '' };
  }
  touchLastSeen(env, user.row); // fire-and-forget
  return publicUser(user);
}

/** Lets a signed-in user edit their own profile (currently the character name). */
async function handleUpdateProfile(request, env, body) {
  const user = await requireRegistered(request, env);
  const character = String(body.character || '').trim();
  if (!character) throw new Error("Your character name can't be empty.");
  await setUserCharacter(env, user.row, character);
  user.character = character;
  return publicUser(user);
}

async function handleRegister(request, env, body) {
  const payload = await requireUser(request, env);
  const existing = await findUserByEmail(env, payload.email);
  if (existing) return publicUser(existing); // idempotent
  const user = await registerUser(env, {
    email: payload.email,
    name: payload.name || '',
    character: body.character,
    businessName: body.businessName,
    asOwner: !!body.asOwner,
    hold: body.hold,
  });
  return publicUser(user);
}

/** Owners/admins only: the roster of their business (admins may pass ?business=). */
async function handleListEmployees(request, env, url) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a business owner or an admin can view the employee roster.');
    e.forbidden = true;
    throw e;
  }
  const business = caller.role === 'admin' && url.searchParams.get('business')
    ? url.searchParams.get('business')
    : caller.business;
  const users = await listUsersByBusiness(env, business);
  return {
    business,
    // Notes are owner/admin-only — they're only ever returned on this roster.
    employees: users.map((u) => ({ uid: u.uid, email: u.email, character: u.character, role: u.role, isOwner: u.isOwner, status: u.status, notes: u.notes || '' })),
  };
}

/** Owners/admins only: set an owner-private note on one of their employees. */
async function handleEmployeeNote(request, env, body) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a business owner or an admin can add employee notes.');
    e.forbidden = true;
    throw e;
  }
  const targetUid = String(body.uid || '').trim();
  if (!targetUid) throw new Error('Which employee? A uid is required.');
  const roster = await listUsersByBusiness(env, caller.business);
  const target = roster.find((u) => u.uid === targetUid);
  // Scope: an owner can only note their OWN business's roster (an admin any).
  const found = target || (caller.role === 'admin' ? await findUserByUid(env, targetUid) : null);
  if (!found) {
    const e = new Error('That employee is not part of your business.');
    e.forbidden = true;
    throw e;
  }
  await setUserNote(env, found.row, body.note);
  return { ok: true, uid: targetUid };
}

/** Requires the caller to be a registered admin. */
async function requireAdmin(request, env) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'admin') {
    const e = new Error('Admins only.');
    e.forbidden = true;
    throw e;
  }
  return caller;
}

async function handleGetSettings(request, env) {
  await requireAdmin(request, env);
  return { settings: await readSettings(env) };
}

async function handleListMembers(request, env) {
  await requireAdmin(request, env);
  return { members: await listAllUsers(env) };
}

async function handleUpdateMember(request, env, body) {
  await requireAdmin(request, env);
  await updateMember(env, body);
  return { members: await listAllUsers(env) };
}

async function handleDeleteMember(request, env, body) {
  await requireAdmin(request, env);
  await deleteMember(env, body.uid);
  return { members: await listAllUsers(env) };
}

async function handleListCompanies(request, env) {
  await requireAdmin(request, env);
  return { companies: await listCompanies(env) };
}

async function handleUpdateCompany(request, env, body) {
  await requireAdmin(request, env);
  return { companies: await updateCompany(env, body) };
}

async function handleDeleteCompany(request, env, body) {
  await requireAdmin(request, env);
  return { companies: await archiveCompany(env, body.id) };
}

/** Admin-only: run the D1 → Sheets backup on demand (the cron does it on a schedule). */
async function handleRunBackup(request, env) {
  await requireAdmin(request, env);
  return await runBackup(env);
}

/** Admin-only: network-wide market analytics over the D1 store. */
async function handleMarket(request, env) {
  await requireAdmin(request, env);
  return await marketAnalysis(env);
}

async function handleSaveSettings(request, env, body) {
  await requireAdmin(request, env);
  return { settings: await writeSettings(env, body.updates || []) };
}

/** Which business a ledger-settings request targets: the caller's, or (admin) any. */
async function ledgerSettingsBusiness(request, env, override) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a shop owner or an admin can manage ledger settings.');
    e.forbidden = true;
    throw e;
  }
  return caller.role === 'admin' && override ? override : caller.business;
}

async function handleGetLedgerSettings(request, env, url) {
  const business = await ledgerSettingsBusiness(request, env, url.searchParams.get('business'));
  return readBusinessSettings(env, business);
}

async function handleSaveLedgerSettings(request, env, body) {
  const business = await ledgerSettingsBusiness(request, env, body.business);
  return writeBusinessSettings(env, business, body.updates || []);
}

/** Owner/admin: rename their company everywhere it's referenced. */
async function handleRenameBusiness(request, env, body) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a shop owner or an admin can rename the company.');
    e.forbidden = true;
    throw e;
  }
  const newName = String(body.name || '').trim();
  if (!newName) throw new Error('Enter a company name.');
  await renameBusiness(env, caller.business, newName);
  await renameBusinessData(env, caller.business, newName); // keep D1 rows aligned
  caller.business = newName;
  return publicUser(caller);
}

/** Any registered user may read their own business's inventory. */
async function handleGetInventory(request, env) {
  const caller = await requireRegistered(request, env);
  return { inventory: await listInventory(env, caller.business) };
}

/** Owner/admin: add or update an inventory item. */
async function handleSaveItem(request, env, body) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a shop owner or an admin can edit inventory.');
    e.forbidden = true;
    throw e;
  }
  return { inventory: await upsertItem(env, caller.business, body) };
}

/** Owner/admin: remove an inventory item. */
async function handleDeleteItem(request, env, body) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a shop owner or an admin can edit inventory.');
    e.forbidden = true;
    throw e;
  }
  return { inventory: await deleteItem(env, caller.business, body.item) };
}

/** Requires a registered user whose account is active (can operate the register). */
async function requireActive(request, env) {
  const user = await requireRegistered(request, env);
  if (user.status !== 'active') {
    const e = new Error('Your account is pending — an owner or admin must activate you before you can use the register.');
    e.forbidden = true;
    throw e;
  }
  return user;
}

async function handleGetCert(request, env) {
  const caller = await requireRegistered(request, env);
  return await checkCertification(env, caller.business);
}

async function handleCheckout(request, env, body) {
  const caller = await requireActive(request, env);
  return await checkout(env, caller.business, caller, body);
}

async function handleListSales(request, env, url) {
  const caller = await requireActive(request, env);
  return { sales: await listSales(env, caller.business, url.searchParams.get('q'), 25) };
}

async function handleVoidSale(request, env, body) {
  const caller = await requireActive(request, env);
  return await voidSale(env, caller.business, body.orderNo);
}

/** Any signed-in user: the network hold list (for intake / sales dropdowns and
 *  the registration form, where the caller isn't registered yet). */
async function handleGetHolds(request, env) {
  await requireUser(request, env);
  return { holds: await readHolds(env) };
}

/** Any registered user: recent intake transactions for their business. */
async function handleGetIntake(request, env) {
  const caller = await requireRegistered(request, env);
  return { intake: await listIntake(env, caller.business, 20) };
}

/** Owner/admin: record a stock intake (purchase) — logs it and adds stock. */
async function handleRecordIntake(request, env, body) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a shop owner or an admin can record intake.');
    e.forbidden = true;
    throw e;
  }
  const intake = await recordIntake(env, caller.business, body);
  return { intake, inventory: await listInventory(env, caller.business) };
}

/** Owners/admins only: activate a pending employee of their own business. */
async function handleActivateEmployee(request, env, body) {
  const caller = await requireRegistered(request, env);
  if (caller.role !== 'owner' && caller.role !== 'admin') {
    const e = new Error('Only a business owner or an admin can activate employees.');
    e.forbidden = true;
    throw e;
  }
  const targetUid = String(body.uid || '').trim();
  if (!targetUid) throw new Error('Which employee? A uid is required.');
  const roster = await listUsersByBusiness(env, caller.business);
  const target = roster.find((u) => u.uid === targetUid);
  // An owner can only touch their OWN business's roster; the scope check IS the
  // security — a uid from another business simply won't be in this list.
  if (!target && caller.role !== 'admin') {
    const e = new Error('That employee is not part of your business.');
    e.forbidden = true;
    throw e;
  }
  const found = target || (caller.role === 'admin' ? (await findUserByUid(env, targetUid)) : null);
  if (!found) throw new Error('No such employee.');
  await setUserStatus(env, found.row, 'active');
  return { ok: true, uid: targetUid, status: 'active' };
}

/** Admin-only helper: locate any user by uid across all businesses. */
async function findUserByUid(env, uid) {
  // Small scale — a linear scan of the Users sheet is fine.
  const rows = await readRange(env, env.CORE_SPREADSHEET_ID, `${USERS_SHEET}!A2:I`);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() === uid) {
      return { uid, business: String(rows[i][2] || '').trim(), row: i + 2 };
    }
  }
  return null;
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env, request);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (request.method === 'GET' && (path === '/health' || path === '/')) {
        // Probe D1: 'ok' means bound + migrated; 'error' means bound but the
        // tables aren't there; 'unbound' means no binding yet.
        let db = 'unbound';
        if (env.DB) {
          try { await ensureSchema(env); await env.DB.prepare('SELECT COUNT(*) AS n FROM inventory').first(); db = 'ok'; }
          catch (e) { db = 'error'; }
        }
        return json({
          ok: true,
          service: 'eec-sales-system-api',
          configured: {
            coreId: !!env.CORE_SPREADSHEET_ID,
            clientId: !!env.GOOGLE_CLIENT_ID,
            saKey: !!env.SA_KEY,
            db,
            backup: !!(env.BACKUP_SPREADSHEET_ID && String(env.BACKUP_SPREADSHEET_ID).trim()),
          },
          time: new Date().toISOString(),
        }, 200, cors);
      }

      if (request.method === 'POST' && path === '/auth/me') {
        return json(await handleMe(request, env), 200, cors);
      }

      if (request.method === 'POST' && path === '/auth/register') {
        const body = await readJsonBody(request);
        return json(await handleRegister(request, env, body), 200, cors);
      }

      if (request.method === 'POST' && path === '/me/profile') {
        const body = await readJsonBody(request);
        return json(await handleUpdateProfile(request, env, body), 200, cors);
      }

      if (request.method === 'GET' && path === '/business/employees') {
        return json(await handleListEmployees(request, env, url), 200, cors);
      }

      if (request.method === 'POST' && path === '/business/employees/activate') {
        const body = await readJsonBody(request);
        return json(await handleActivateEmployee(request, env, body), 200, cors);
      }

      if (request.method === 'POST' && path === '/business/employees/note') {
        const body = await readJsonBody(request);
        return json(await handleEmployeeNote(request, env, body), 200, cors);
      }

      if (request.method === 'GET' && path === '/admin/settings') {
        return json(await handleGetSettings(request, env), 200, cors);
      }

      if (request.method === 'POST' && path === '/admin/settings') {
        const body = await readJsonBody(request);
        return json(await handleSaveSettings(request, env, body), 200, cors);
      }

      if (request.method === 'GET' && path === '/admin/members') {
        return json(await handleListMembers(request, env), 200, cors);
      }

      if (request.method === 'POST' && path === '/admin/members/update') {
        const body = await readJsonBody(request);
        return json(await handleUpdateMember(request, env, body), 200, cors);
      }

      if (request.method === 'POST' && path === '/admin/members/delete') {
        const body = await readJsonBody(request);
        return json(await handleDeleteMember(request, env, body), 200, cors);
      }

      if (request.method === 'GET' && path === '/admin/companies') {
        return json(await handleListCompanies(request, env), 200, cors);
      }

      if (request.method === 'POST' && path === '/admin/companies/update') {
        const body = await readJsonBody(request);
        return json(await handleUpdateCompany(request, env, body), 200, cors);
      }

      if (request.method === 'POST' && path === '/admin/companies/delete') {
        const body = await readJsonBody(request);
        return json(await handleDeleteCompany(request, env, body), 200, cors);
      }

      if (request.method === 'POST' && path === '/admin/backup') {
        return json(await handleRunBackup(request, env), 200, cors);
      }

      if (request.method === 'GET' && path === '/admin/market') {
        return json(await handleMarket(request, env), 200, cors);
      }

      if (request.method === 'GET' && path === '/business/settings') {
        return json(await handleGetLedgerSettings(request, env, url), 200, cors);
      }

      if (request.method === 'POST' && path === '/business/settings') {
        const body = await readJsonBody(request);
        return json(await handleSaveLedgerSettings(request, env, body), 200, cors);
      }

      if (request.method === 'POST' && path === '/business/rename') {
        const body = await readJsonBody(request);
        return json(await handleRenameBusiness(request, env, body), 200, cors);
      }

      if (request.method === 'GET' && path === '/inventory') {
        return json(await handleGetInventory(request, env), 200, cors);
      }

      if (request.method === 'POST' && path === '/inventory') {
        const body = await readJsonBody(request);
        return json(await handleSaveItem(request, env, body), 200, cors);
      }

      if (request.method === 'POST' && path === '/inventory/delete') {
        const body = await readJsonBody(request);
        return json(await handleDeleteItem(request, env, body), 200, cors);
      }

      if (request.method === 'GET' && path === '/holds') {
        return json(await handleGetHolds(request, env), 200, cors);
      }

      if (request.method === 'GET' && path === '/intake') {
        return json(await handleGetIntake(request, env), 200, cors);
      }

      if (request.method === 'POST' && path === '/intake') {
        const body = await readJsonBody(request);
        return json(await handleRecordIntake(request, env, body), 200, cors);
      }

      if (request.method === 'GET' && path === '/cert') {
        return json(await handleGetCert(request, env), 200, cors);
      }

      if (request.method === 'POST' && path === '/sale') {
        const body = await readJsonBody(request);
        return json(await handleCheckout(request, env, body), 200, cors);
      }

      if (request.method === 'GET' && path === '/sales') {
        return json(await handleListSales(request, env, url), 200, cors);
      }

      if (request.method === 'POST' && path === '/sales/void') {
        const body = await readJsonBody(request);
        return json(await handleVoidSale(request, env, body), 200, cors);
      }

      return json({ error: 'Not found: ' + path }, 404, cors);
    } catch (err) {
      // Map error kinds to status codes; the frontend surfaces .error verbatim.
      // Stack traces never leave the Worker.
      const msg = err && err.message ? err.message : String(err);
      let status = 400;
      if (err && err.forbidden) status = 403;
      else if (err && err.notRegistered) status = 403;
      else if (/token|bearer|verified|audience|expired|issuer/i.test(msg)) status = 401;
      return json({ error: msg }, status, cors);
    }
  },

  /**
   * Cron Trigger (wrangler.toml [triggers]) — the slow, operator-owned backup.
   * Runs off the request path; errors are logged, not surfaced (no client).
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runBackup(env)
        .then((r) => console.log('Scheduled backup:', JSON.stringify(r)))
        .catch((e) => console.error('Scheduled backup failed:', e && e.message ? e.message : String(e)))
    );
  },
};
