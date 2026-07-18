/**
 * Google ID-token verification — the heart of the trust boundary.
 *
 * The browser sends the Google ID token it got from Sign-In. We verify the
 * RS256 signature against Google's published JWKS, then check issuer, audience
 * (our OAuth client ID), and expiry. Only after this do we trust the email.
 *
 * A forged or altered token fails the signature check; a token minted for a
 * different site fails the audience check. This is what makes "who are you"
 * answerable on a static frontend.
 */

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

let jwksCache = { keys: null, exp: 0 };

async function getJwks() {
  const now = Date.now();
  if (jwksCache.keys && jwksCache.exp > now) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  const data = await res.json();
  // Honor Google's Cache-Control max-age when present; default 1h.
  let ttl = 3600;
  const cc = res.headers.get('cache-control') || '';
  const m = cc.match(/max-age=(\d+)/);
  if (m) ttl = parseInt(m[1], 10);
  jwksCache = { keys: data.keys, exp: now + ttl * 1000 };
  return data.keys;
}

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
function b64urlToJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

/**
 * Verifies an ID token. Returns the decoded payload ({ email, email_verified,
 * name, picture, ... }) on success; throws on any failure.
 */
export async function verifyIdToken(idToken, expectedAud) {
  if (!idToken || idToken.split('.').length !== 3) {
    throw new Error('Malformed ID token.');
  }
  const [headerB64, payloadB64, sigB64] = idToken.split('.');
  const header = b64urlToJson(headerB64);
  const payload = b64urlToJson(payloadB64);

  const keys = await getJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Signing key not found in Google JWKS.');

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    b64urlToBytes(sigB64),
    new TextEncoder().encode(headerB64 + '.' + payloadB64)
  );
  if (!valid) throw new Error('ID token signature is invalid.');

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error('ID token has expired — sign in again.');
  if (!ISSUERS.includes(payload.iss)) throw new Error('Unexpected token issuer.');
  if (expectedAud && payload.aud !== expectedAud) {
    throw new Error('Token audience mismatch — this token was not issued for this app.');
  }
  if (payload.email_verified === false) throw new Error('Google email is not verified.');
  return payload;
}
