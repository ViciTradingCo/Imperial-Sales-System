/**
 * LINES THE APP ASSEMBLES AT RUNTIME, checked against every finished pack.
 *
 * The dictionary is keyed on WHOLE TEXT NODES, and the extractor can only
 * catalogue what it can see in the source. A line built at runtime out of two
 * catalogue phrases — `a + ' · ' + b` — reaches the page as one node that is
 * neither of them, so the exact lookup misses and the matcher falls through to
 * the templates. Then the damage: `{0}` is a greedy-enough hole that the first
 * template which fits EATS THE OTHER HALF. A German roster read
 *
 *     "5gp an hour · 10 % Provision"
 *
 * — the commission template matched with "5gp an hour · 10" sitting in its
 * placeholder. The time card was worse and every case of it was broken:
 * "You are paid {0}." matched the whole sentence and put the untranslated
 * middle straight back into the hole, so a German reader was told
 * "Du wirst mit 5gp an hour bezahlt."
 *
 * NOTHING FAILS WHEN THIS HAPPENS. No error, no blank, no missing key — the
 * page renders and reads wrong only to somebody who speaks the language. That
 * is what makes it worth a test rather than a careful look.
 *
 * So these drive the REAL view functions through the REAL matcher, and ask the
 * one question that does not depend on knowing any of these languages: did the
 * pack MOVE the line? A line that comes back exactly as its English was never
 * recognised, whatever it looks like.
 *
 * WHAT THIS CANNOT SEE, so that nobody trusts it too far. The time card's three
 * sentences render the same English as the single stem they replaced — the
 * change was made so the EXTRACTOR would catalogue three whole sentences rather
 * than one useless `"You are paid {0}."` — so collapsing them back would pass
 * here and break every pack. That direction is `npm run i18n:check`'s job: it
 * reports the entries that fall out of the catalogue, and a string going stale
 * is a thing to read before pruning past.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LANGS } from '../../src/lib/i18n.js';

/**
 * The browser bits `applyLang` needs. It walks `document.body` and installs a
 * MutationObserver; a body whose childNodes we swap between calls is enough to
 * push one text node through the same path a rendered node takes.
 */
const body = { nodeType: 1, hasAttribute: () => false, childNodes: [] };
let lang = 'en';
let applyLang;
let earningsLine;
let payTerms;

beforeAll(async () => {
  globalThis.localStorage = { getItem: () => lang, setItem: () => {} };
  globalThis.MutationObserver = class { observe() {} };
  globalThis.document = { body };
  ({ applyLang } = await import('../../src/lib/i18n.js'));
  // Both live in `lib/format.js`: one fact — what somebody earns — told to two
  // audiences, and the i18n trap they share is explained once, over them.
  ({ earningsLine, payTerms } = await import('../../src/lib/format.js'));
});
afterAll(() => {
  delete globalThis.localStorage;
  delete globalThis.MutationObserver;
  delete globalThis.document;
});

/** Builds the line in `l`, then puts it through the DOM pass as the observer would. */
async function render(l, build) {
  lang = l;
  await applyLang();          // loads the pack; `t()` inside `build` needs it first
  const text = build();
  const node = { nodeType: 3, nodeValue: text };
  body.childNodes = [node];
  await applyLang();
  return node.nodeValue;
}

/** Every finished language except English, which has no pack and no work to do. */
const PACKS = Object.keys(LANGS).filter((l) => l !== 'en');

/**
 * The assertion, in the only form that works without reading four languages:
 * the same line built under English and under the pack must DIFFER. Testing for
 * leftover English words cannot do this — French for commission is
 * "commission", and "de commission" is a correct translation that a word search
 * would call a failure.
 */
async function expectTranslated(l, build, what) {
  const english = await render('en', build);
  const out = await render(l, build);
  expect(out, l + ': ' + what + ' came back untouched — the pack never matched it')
    .not.toBe(english);
  return out;
}

describe('the roster’s pay line', () => {
  const cases = [
    ['an hourly rate and a commission', () => earningsLine(5, 10)],
    ['an hourly rate alone', () => earningsLine(5, 0)],
    ['a commission alone', () => earningsLine(0, 10)],
  ];
  for (const l of PACKS) {
    for (const [what, build] of cases) {
      it(`${l}: ${what}`, async () => { await expectTranslated(l, build, what); });
    }
  }

  /**
   * The original failure, pinned directly: with both halves set, neither may
   * survive in English. Checking only that the line CHANGED would pass on the
   * half-eaten version, which is exactly what shipped.
   */
  it('translates BOTH halves, never one of them', async () => {
    for (const l of PACKS) {
      const out = await expectTranslated(l, () => earningsLine(5, 10), 'both halves');
      expect(out, l + ': the hourly half was left behind').not.toContain('an hour');
      // Each half still stands on its own inside the joined line.
      const alone = await render(l, () => earningsLine(5, 0));
      expect(out, l + ': the joined line disagrees with the hourly line alone').toContain(alone);
    }
  });

  it('says so plainly when nobody has set any pay', async () => {
    for (const l of PACKS) {
      await expectTranslated(l, () => earningsLine(0, 0), 'no pay set');
    }
  });
});

describe('the time card’s pay line', () => {
  const cases = [
    ['an hourly rate and a commission', () => payTerms(5, 10)],
    ['an hourly rate alone', () => payTerms(5, 0)],
    ['a commission alone', () => payTerms(0, 10)],
    ['no pay set at all', () => payTerms(0, 0)],
  ];
  for (const l of PACKS) {
    for (const [what, build] of cases) {
      it(`${l}: ${what}`, async () => {
        const out = await expectTranslated(l, build, what);
        // The stem is the part that used to translate while its own clause did
        // not, which is the tell-tale of a sentence matched as a template and
        // handed back its English middle.
        expect(out, l + ': the clause inside the sentence is still English')
          .not.toMatch(/an hour|of what you sell/);
      });
    }
  }
});

/**
 * A line is only translatable if it reaches the page as ONE recognisable node,
 * so a view that joins prose has to translate the pieces first. These are the
 * other three that did not, kept here because the mistake is easy to make again
 * and invisible when it is.
 */
describe('other lines built from a phrase and a name', () => {
  // `t` is applied inside the views; this mirrors what each of them now builds.
  let t;
  beforeAll(async () => { ({ t } = await import('../../src/lib/i18n.js')); });

  const cases = [
    ['the harvest rate beside a category (produce.js)', () => [t('pays 5gp each'), 'Weapons'].filter(Boolean).join(' · ')],
    ['the stock count beside a type (pos.js)', () => [t('3 in stock'), 'Weapons'].filter(Boolean).join(' · ')],
    ['who first rang an item up (item-index.js)', () => t('by Sera at The Forge')],
  ];
  for (const l of PACKS) {
    for (const [what, build] of cases) {
      it(`${l}: ${what}`, async () => { await expectTranslated(l, build, what); });
    }
  }
});
