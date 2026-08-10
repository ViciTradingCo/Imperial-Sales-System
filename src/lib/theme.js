/**
 * SURFACES — what the ledger is written ON. Stored client-side (localStorage)
 * so the choice applies instantly and follows the browser rather than the
 * account.
 *
 * THE COLOURS ARE NOT HERE. Each surface's palette and texture live in
 * `theme.css` under `[data-theme="…"]`, and this module's only job at apply
 * time is to set that attribute. Two things follow: the surface is painted
 * before a line of this file runs, so there is no flash of the default page
 * while the module loads; and a surface listed here but never styled cannot
 * half-exist, because there is nothing here to half-apply.
 *
 * What IS here is the list a person chooses from, and what each one is called.
 * TEXT SIZE works the same way: `--type-scale` and its steps are in the
 * stylesheet, and this only names one.
 */
const KEY = 'eec.prefs';

export const THEMES = {
  ledger: { label: 'Ledger book', hint: 'Ruled cream leaves, red margin' },
  scroll: { label: 'Scroll', hint: 'Unruled vellum, darker at the edges' },
  tome: { label: 'Midnight tome', hint: 'Dark binding, read by candlelight' },
};

/**
 * How big the writing is. One scale drives the hand, the data face AND the
 * ruled line, so a larger size still sits on the rules.
 *
 * A handwritten face is harder to read small than an upright one, so this is
 * worth having however good anyone's eyes are — and it is per device, because
 * the phone in someone's hand and the monitor on their desk are not the same
 * reading distance.
 */
export const TEXT_SIZES = {
  small: { label: 'Small' },
  normal: { label: 'Normal' },
  large: { label: 'Large' },
  larger: { label: 'Largest' },
};

const DEFAULT_THEME = 'ledger';
const DEFAULT_TEXT = 'normal';
const DEFAULT_PREFS = { theme: DEFAULT_THEME, text: DEFAULT_TEXT };

/**
 * Surfaces that have been renamed, mapped to what replaced them.
 *
 * A stored choice must not silently reset because the option it names was
 * rebuilt: someone who picked the dark theme wants the dark one, and `slate`
 * was the cool-toned dark the tome now covers.
 */
const RENAMED = { parchment: 'ledger', midnight: 'tome', slate: 'tome' };

/** The surface a stored preference means, after renames and fallbacks. */
export function resolveTheme(name) {
  const key = RENAMED[name] || name;
  return THEMES[key] ? key : DEFAULT_THEME;
}

/** The text size a stored preference means. */
export function resolveText(name) {
  return TEXT_SIZES[name] ? name : DEFAULT_TEXT;
}

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

/** Applies a prefs object by naming both choices on <html>; CSS does the rest. */
export function applyPrefs(prefs) {
  const p = prefs || loadPrefs();
  const root = document.documentElement;
  root.setAttribute('data-theme', resolveTheme(p.theme));
  root.setAttribute('data-text', resolveText(p.text));
}
