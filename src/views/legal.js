/**
 * The Terms of Service and the Privacy Policy — one renderer, because they are
 * the same shape and a second copy is how two pages start disagreeing about
 * their own layout.
 *
 * READABLE SIGNED OUT, which is the whole point of a privacy policy: somebody
 * deciding whether to hand over their email must be able to read what happens
 * to it BEFORE they do. Both routes render for a visitor with no session, and
 * neither asks the API for anything.
 *
 * The DOCUMENT is English only and says so under its own title — see
 * `src/lib/legal.js` for why. The frame around it (the back link, the nav, the
 * footer) is translated like the rest of the app: a reader in German gets a
 * German app holding an English document, which is the ordinary arrangement and
 * is honest about which is which.
 */
import { el, mount } from '../lib/dom.js';
import { navigate } from '../lib/router.js';
import { LEGAL_DOCS, LEGAL_UPDATED } from '../lib/legal.js';
import { formatDate } from '../lib/format.js';

/** A section's body: a string is a paragraph, an array is a bulleted list. */
function bodyNodes(body) {
  return (body || []).map((part) => Array.isArray(part)
    ? el('ul', { class: 'feature-list' }, part.map((line) => el('li', {}, line)))
    : el('p', {}, part));
}

/**
 * `which` is 'terms' or 'privacy'. An unknown key goes home rather than
 * throwing — the routes only ever pass those two, but a typed URL is exactly
 * where a third would come from.
 */
export function renderLegal(container, which) {
  const doc = LEGAL_DOCS[which];
  if (!doc) { navigate('/'); return; }
  const other = which === 'privacy' ? LEGAL_DOCS.terms : LEGAL_DOCS.privacy;

  mount(container, el('div.card.legal', {}, [
    el('button', { class: 'link-back', onclick: () => navigate('/about') }, '← Back'),
    el('h2', {}, doc.title),
    el('p', { class: 'note' }, 'Last updated ' +
      formatDate(LEGAL_UPDATED, { day: 'numeric', month: 'long', year: 'numeric' }) + '.'),
    // Translated, unlike the document it introduces: a notice explaining why
    // the rest of the page is English is worth nothing to the reader who needed
    // it if it is also in English.
    el('p', { class: 'note' }, 'The Ledger is written in several languages; these two documents are ' +
      'kept in English only, because a mistranslated sentence about somebody’s data would be worse ' +
      'than one they have to read in a second language. The English is the authoritative version.'),
    el('hr', { class: 'card-rule' }),
    el('p', {}, doc.intro),
    ...doc.sections.flatMap((s) => [el('h3', {}, s.heading), ...bodyNodes(s.body)]),
    el('hr', { class: 'card-rule' }),
    // The other document, from the foot of this one: somebody who has just read
    // one is the likeliest person in the app to want the other.
    el('p', { class: 'note' }, [
      'See also: ',
      el('button', { class: 'link-inline', onclick: () => navigate('/' + other.key) }, other.title),
    ]),
  ]));
}
