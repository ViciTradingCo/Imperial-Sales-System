/**
 * GUI theming — per-user appearance preferences, stored client-side
 * (localStorage) so they apply instantly and follow the browser. Themes set the
 * same CSS custom properties the whole app is built on, so every view — and
 * every view added later — picks them up for free.
 */
const KEY = 'eec.prefs';

// Each theme is a full set of the CSS variables theme.css declares on :root.
export const THEMES = {
  parchment: {
    label: 'Parchment (light)',
    vars: {
      '--paper': '#f5e6c8', '--paper-raised': '#fffaf0', '--header-bg': '#3d2f23',
      '--header-text': '#f5e6c8', '--accent': '#7a4a1f', '--ink': '#2b2118',
      '--note': '#7a6a4f', '--good': '#2f5c3a', '--warn': '#a05c1f', '--bad': '#8c2f2f',
    },
  },
  midnight: {
    label: 'Midnight (dark)',
    vars: {
      '--paper': '#17130d', '--paper-raised': '#221c14', '--header-bg': '#0e0b07',
      '--header-text': '#f5e6c8', '--accent': '#c1873f', '--ink': '#eadcc2',
      '--note': '#9a8b6e', '--good': '#6cc08a', '--warn': '#d69a5a', '--bad': '#e58484',
    },
  },
  slate: {
    label: 'Slate (cool dark)',
    vars: {
      '--paper': '#12161b', '--paper-raised': '#1b212a', '--header-bg': '#0c0f13',
      '--header-text': '#e7eef7', '--accent': '#5b8fb0', '--ink': '#dbe3ec',
      '--note': '#8b97a6', '--good': '#5bbf8a', '--warn': '#cf9a54', '--bad': '#e07b7b',
    },
  },
};

export const DEFAULT_PREFS = { theme: 'parchment' };

export function loadPrefs() {
  try {
    return Object.assign({}, DEFAULT_PREFS, JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch (e) {
    return Object.assign({}, DEFAULT_PREFS);
  }
}

export function savePrefs(prefs) {
  const merged = Object.assign(loadPrefs(), prefs);
  try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch (e) { /* private mode */ }
  applyPrefs(merged);
  return merged;
}

/** Applies a prefs object to the document root by setting CSS variables. */
export function applyPrefs(prefs) {
  const p = prefs || loadPrefs();
  const theme = THEMES[p.theme] || THEMES.parchment;
  const root = document.documentElement;
  Object.keys(theme.vars).forEach((k) => root.style.setProperty(k, theme.vars[k]));
  root.setAttribute('data-theme', p.theme);
}
