/**
 * Frontend → Worker API client. Every call carries the Google ID token as a
 * Bearer credential; the Worker verifies it and scopes the response to the
 * caller's role/business. The browser never talks to Google Sheets directly and
 * never holds any service-account secret.
 */
import { getIdToken } from './auth.js';

let baseUrl = '';
export function configureApi(url) { baseUrl = String(url || '').replace(/\/$/, ''); }

async function request(method, path, body) {
  const token = getIdToken();
  const headers = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  // text/plain avoids a CORS preflight for simple POSTs; the Worker parses JSON.
  if (body !== undefined) headers['Content-Type'] = 'text/plain;charset=utf-8';

  let res;
  try {
    res = await fetch(baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new Error('Could not reach the API at ' + baseUrl + ' — check apiBaseUrl in app-config.json and that the Worker is deployed.');
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON error body */ }

  if (!res.ok) {
    const msg = (data && data.error) || text || (res.status + ' ' + res.statusText);
    throw new Error(msg);
  }
  return data;
}

export const api = {
  health: () => request('GET', '/health'),
  /** Verifies the signed-in user and returns their profile, or {registered:false}. */
  me: () => request('POST', '/auth/me', {}),
  /** Registers the signed-in user against a business (as owner or employee). */
  register: (businessName, asOwner, character) =>
    request('POST', '/auth/register', { businessName, asOwner: !!asOwner, character }),
  /** Owner/admin: the roster for the caller's business. */
  listEmployees: () => request('GET', '/business/employees'),
  /** Owner/admin: activate a pending employee. */
  activateEmployee: (uid) => request('POST', '/business/employees/activate', { uid }),
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body || {}),
};
