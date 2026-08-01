/**
 * Sitewide branding — the app name, logo, favicon, tagline, footer, and accent
 * an admin controls from Network Settings. Fetched once (public endpoint, so it
 * also brands the signed-out landing) and applied to the shell.
 */
import { api } from './api.js';

const DEFAULTS = {
  appName: 'Vici Trading Co.',
  shortName: 'Vici Ledger',
  tagline: 'The Vici Automated Ledger',
  logoUrl: '',
  faviconUrl: '',
  footerText: 'The Vici Automated Ledger · created by SmileDaemon',
  accent: '',
};

let current = { ...DEFAULTS };

/** The branding in effect right now (defaults until the fetch resolves). */
export function branding() { return { ...current }; }

/** Paints branding onto the shell: title, header, logo, favicon, footer, accent. */
export function applyBranding(b) {
  current = { ...DEFAULTS, ...(b || {}) };

  document.title = current.tagline || current.appName;

  const h1 = document.querySelector('.topbar h1');
  if (h1) {
    h1.textContent = '';
    if (current.logoUrl) {
      const img = document.createElement('img');
      img.src = current.logoUrl;
      img.alt = '';
      img.className = 'brand-logo';
      img.addEventListener('error', () => img.remove());
      h1.appendChild(img);
    }
    h1.appendChild(document.createTextNode(current.tagline || current.appName));
  }

  if (current.faviconUrl) {
    document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((l) => {
      l.href = current.faviconUrl;
    });
  }

  const footer = document.querySelector('.footer span');
  if (footer && current.footerText) footer.textContent = current.footerText;

  if (current.accent) document.documentElement.style.setProperty('--accent', current.accent);
}

/** Loads branding from the API (public) and applies it. Never throws. */
export async function loadBranding() {
  try {
    const b = await api.getBranding();
    applyBranding(b);
    return b;
  } catch (e) {
    applyBranding(DEFAULTS);
    return DEFAULTS;
  }
}
