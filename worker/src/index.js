/**
 * Vici Trading Co. Sales System — backend API (Cloudflare Worker). THE trust boundary.
 *
 * This module is only the shell: CORS, the request-size cap, rate limiting, the
 * /health probe, and dispatch to the route tables. Authorization and data logic
 * live in the route modules (routes/*.js) and the guards they call — never in the
 * browser.
 *
 *   • Identity  — Google ID token verified in verify.js, mapped to a D1 users row.
 *   • Data      — Cloudflare D1 is the sole source of truth (no Google Sheets).
 *   • Backups   — admin file export/import + an optional scheduled R2 snapshot.
 *
 * Config (wrangler.toml [vars] / secrets): GOOGLE_CLIENT_ID, ALLOWED_ORIGIN,
 *   ADMIN_EMAILS (bootstraps the first admin), and optional bindings DB (D1),
 *   BACKUPS (R2), KV (cache).
 */
import { corsHeaders, json, errorStatus, dispatch } from './http.js';
import { rateHit, isPriorityToken, MAX_BODY_BYTES } from './ratelimit.js';
import { ensureSchema } from './db.js';
import { recordError } from './status.js';
import { runScheduledBackup } from './backup-cron.js';
import { purgeExpiredSessions } from './sessions.js';
import { routes as authRoutes } from './routes/auth.js';
import { routes as adminRoutes } from './routes/admin.js';
import { routes as businessRoutes } from './routes/business.js';
import { routes as courtRoutes } from './routes/court.js';

const ROUTES = [...authRoutes, ...adminRoutes, ...businessRoutes, ...courtRoutes];

async function healthResponse(env, cors) {
  // Probe D1: 'ok' = bound + migrated; 'error' = bound but tables missing;
  // 'unbound' = no binding yet.
  let db = 'unbound';
  if (env.DB) {
    try { await ensureSchema(env); await env.DB.prepare('SELECT COUNT(*) AS n FROM inventory').first(); db = 'ok'; }
    catch (e) { db = 'error'; }
  }
  return json({
    ok: true,
    service: 'eec-sales-system-api',
    configured: {
      clientId: !!env.GOOGLE_CLIENT_ID,
      admins: !!String(env.ADMIN_EMAILS || '').trim(),
      backups: !!env.BACKUPS,
      db,
    },
    time: new Date().toISOString(),
  }, 200, cors);
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env, request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // Request-size cap (cheap abuse guard). The backup restore is exempt — it's
    // an admin-only full-data upload that can legitimately be large.
    if (path !== '/admin/import' && Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) {
      return json({ error: 'Request too large.' }, 413, cors);
    }
    // Rate limit — keyed by token (or IP), with a higher ceiling for priority
    // businesses (learned at /auth/me). Health checks are exempt.
    if (path !== '/health' && path !== '/') {
      const tok = (String(request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i) || [])[1] || '';
      const key = tok ? 'tok:' + tok : 'ip:' + (request.headers.get('CF-Connecting-IP') || 'unknown');
      const rl = rateHit(key, isPriorityToken(tok));
      if (!rl.ok) return json({ error: 'Rate limit exceeded — slow down.' }, 429, { ...cors, 'Retry-After': String(rl.retryAfter) });
    }

    try {
      if (request.method === 'GET' && (path === '/health' || path === '/')) {
        return await healthResponse(env, cors);
      }
      const res = await dispatch(ROUTES, { request, env, url, path, cors });
      if (res) return res;
      return json({ error: 'Not found: ' + path }, 404, cors);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      const status = errorStatus(err);
      // Record genuine internal faults (D1/runtime errors, not routine auth or
      // input validation) for the admin System Status panel. Best-effort.
      const internal = /D1_ERROR|SQLITE|not connected|is not defined|is not a function|cannot read|undefined is not|TypeError|RangeError|Internal/i.test(msg);
      if (internal) { try { await recordError(env, path, msg); } catch (e) { /* best-effort */ } }
      return json({ error: msg }, status, cors);
    }
  },

  /**
   * Daily housekeeping: the off-site backup to R2 (see backup-cron.js, a no-op
   * if unconfigured) and clearing out sessions that have expired. Neither is
   * load-bearing — an expired session is already refused on sight; this only
   * stops the table growing a row per sign-in forever.
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledBackup(env).catch((e) => recordError(env, 'cron:backup', e && e.message ? e.message : String(e))));
    ctx.waitUntil(purgeExpiredSessions(env).catch((e) => recordError(env, 'cron:sessions', e && e.message ? e.message : String(e))));
  },
};
