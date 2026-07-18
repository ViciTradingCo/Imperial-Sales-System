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
import { findUserByEmail } from './users.js';

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

async function handleMe(request, env) {
  const payload = await requireUser(request, env);
  const user = await findUserByEmail(env, payload.email);
  if (!user) {
    return {
      registered: false,
      email: payload.email,
      name: payload.name || '',
    };
  }
  return {
    registered: true,
    uid: user.uid,
    email: user.email,
    business: user.business,
    role: user.role,
    isOwner: user.isOwner,
    status: user.status,
  };
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
        const body = await handleMe(request, env);
        return json(body, 200, cors);
      }

      return json({ error: 'Not found: ' + path }, 404, cors);
    } catch (err) {
      // Auth failures are 401; everything else 400 with the message (the
      // frontend surfaces it verbatim). Stack traces never leave the Worker.
      const msg = err && err.message ? err.message : String(err);
      const status = /token|bearer|verified|audience|expired|issuer/i.test(msg) ? 401 : 400;
      return json({ error: msg }, status, cors);
    }
  },
};
