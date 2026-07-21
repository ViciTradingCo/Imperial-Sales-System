/**
 * HTTP plumbing shared by the router and route modules: CORS, JSON responses,
 * body parsing, error→status mapping, and the route dispatcher.
 *
 * A route is { method, path, handler }. The handler receives a context object
 * { request, env, url, path, body, cors } — the body is parsed ONCE here (the
 * old per-route readJsonBody boilerplate) — and returns either a plain object
 * (wrapped as JSON) or a Response (used as-is, e.g. a file download).
 */

export function corsHeaders(env, request) {
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

export function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
  });
}

/** Parses a JSON request body sent as text/plain (our CORS-preflight-free shape). */
export async function readJsonBody(request) {
  const text = await request.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch (e) { throw new Error('Request body was not valid JSON.'); }
}

/** Maps an error to an HTTP status. Stack traces never leave the Worker. */
export function errorStatus(err) {
  const msg = err && err.message ? err.message : String(err);
  if (err && err.forbidden) return 403;
  if (err && err.notRegistered) return 403;
  if (/token|bearer|verified|audience|expired|issuer/i.test(msg)) return 401;
  return 400;
}

/**
 * Finds and runs the matching route. Returns a Response, or null if no route
 * matched (the caller renders a 404). Body is parsed once, here.
 */
export async function dispatch(routes, ctx) {
  for (const r of routes) {
    if (r.method === ctx.request.method && r.path === ctx.path) {
      if (ctx.request.method !== 'GET') ctx.body = await readJsonBody(ctx.request);
      const out = await r.handler(ctx);
      return out instanceof Response ? out : json(out, 200, ctx.cors);
    }
  }
  return null;
}
