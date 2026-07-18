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
import { findUserByEmail, listUsersByBusiness, setUserStatus, touchLastSeen, USERS_SHEET } from './users.js';
import { registerUser } from './registry.js';
import { readRange } from './sheets.js';

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
    employees: users.map((u) => ({ uid: u.uid, email: u.email, character: u.character, role: u.role, isOwner: u.isOwner, status: u.status })),
  };
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
        return json({
          ok: true,
          service: 'eec-sales-system-api',
          configured: {
            coreId: !!env.CORE_SPREADSHEET_ID,
            clientId: !!env.GOOGLE_CLIENT_ID,
            saKey: !!env.SA_KEY,
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

      if (request.method === 'GET' && path === '/business/employees') {
        return json(await handleListEmployees(request, env, url), 200, cors);
      }

      if (request.method === 'POST' && path === '/business/employees/activate') {
        const body = await readJsonBody(request);
        return json(await handleActivateEmployee(request, env, body), 200, cors);
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
};
