/**
 * Loads the PUBLIC app config (OAuth client ID, API URL, Core sheet ID) once.
 * Nothing secret lives here — see app-config.json. Fetched at runtime rather
 * than bundled so the same build can be pointed at a different Core/API by
 * editing one JSON file.
 */
let cached = null;

export async function loadConfig() {
  if (cached) return cached;
  const res = await fetch(`${import.meta.env.BASE_URL}app-config.json`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Could not load app-config.json — the site is not configured yet. See docs/SETUP.md.');
  }
  cached = await res.json();
  const missing = ['googleClientId', 'apiBaseUrl', 'coreSpreadsheetId']
    .filter((k) => !cached[k] || String(cached[k]).startsWith('REPLACE_WITH_'));
  if (missing.length) {
    throw new Error(
      'app-config.json still has placeholder value(s) for: ' + missing.join(', ') +
      '.\nFill these in per docs/SETUP.md before the app can run.'
    );
  }
  return cached;
}
