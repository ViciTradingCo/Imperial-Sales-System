/**
 * Service-account authentication for the Sheets API.
 *
 * The Worker holds a Google service-account key (as the SA_KEY secret — a JSON
 * string). To call Sheets we mint a short-lived OAuth access token by signing a
 * JWT with the SA private key (RS256) and exchanging it at Google's token
 * endpoint. The access token is cached in module scope until shortly before it
 * expires, so most requests skip the exchange.
 *
 * The private key NEVER leaves the Worker. The browser never sees it.
 */

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
let tokenCache = { token: null, exp: 0 };

function b64url(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlStr(str) { return b64url(new TextEncoder().encode(str)); }

/** PEM (PKCS#8) → CryptoKey for RS256 signing. */
async function importPrivateKey(pem) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/** Returns a cached-or-fresh access token for the Sheets scope. */
export async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.exp - 60 > now) return tokenCache.token;

  let key;
  try {
    key = JSON.parse(env.SA_KEY);
  } catch (e) {
    throw new Error('SA_KEY secret is missing or not valid JSON — set it with `wrangler secret put SA_KEY`.');
  }

  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: key.client_email,
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = b64urlStr(JSON.stringify(header)) + '.' + b64urlStr(JSON.stringify(claim));
  const cryptoKey = await importPrivateKey(key.private_key);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsigned)
  );
  const jwt = unsigned + '.' + b64url(sig);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error('Service-account token exchange failed: ' + (data.error_description || data.error || res.status));
  }
  tokenCache = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return tokenCache.token;
}
