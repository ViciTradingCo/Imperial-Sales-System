/**
 * How amounts are printed.
 *
 * Whole coins, rounded DOWN — and the same figure the ledger stores, because
 * this must agree with `coin` in worker/src/money.js. A fraction may be typed
 * in; nothing fractional comes out.
 *
 * The frontend has no test runner of its own; format.js is pure and imports
 * nothing, so it runs here.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { money, setCurrency, currency, setRegion, regionLabel, regionWord, regionsOn,
  formatDate, formatDateTime, weekdayName } from '../../src/lib/format.js';
import { coin } from '../src/money.js';

beforeEach(() => setCurrency('gp'));

describe('money', () => {
  it('prints whole amounts as they are', () => {
    expect(money(25)).toBe('25gp');
    expect(money(0)).toBe('0gp');
    expect(money(1240)).toBe('1240gp');
    expect(money(-30)).toBe('-30gp');
  });

  it('drops the fraction rather than rounding it up', () => {
    expect(money(22.5)).toBe('22gp');    // 10% off 25 — the half coin goes
    expect(money(21.25)).toBe('21gp');   // 15% off 25
    expect(money(0.5)).toBe('0gp');
  });

  it('does not lose a coin to a float tail', () => {
    // The reason the settle comes first: these are the shapes a summed day of
    // takings actually arrives in, and a bare floor would report 1239.
    expect(money(1239.9999999999998)).toBe('1240gp');
    expect(money(299.99999999999994)).toBe('300gp');
    expect(money(1240.0000000000002)).toBe('1240gp');
    expect(money(0.1 + 0.2)).toBe('0gp');
  });

  it('settles noise without swallowing a real fraction', () => {
    // The tolerance has to sit between the two. Settling at 2dp would round
    // 12.999 UP to 13, which is the one thing rounding down must never do.
    expect(money(12.999)).toBe('12gp');
    expect(money(12.9999)).toBe('12gp');
    expect(money(0.999999)).toBe('0gp');
  });

  it('treats nonsense as nothing rather than printing NaN', () => {
    expect(money(undefined)).toBe('0gp');
    expect(money(null)).toBe('0gp');   // Number(null) is 0
    expect(money('abc')).toBe('0gp');
    expect(money(Infinity)).toBe('0gp');
  });

  it('reads a numeric string, since that is what a form field gives', () => {
    expect(money('25')).toBe('25gp');
    expect(money('22.50')).toBe('22gp');
  });

  it("uses the realm's denomination", () => {
    setCurrency('septims');
    expect(money(25)).toBe('25septims');
    expect(currency()).toBe('septims');
    setCurrency('');           // empty falls back rather than printing bare
    expect(money(25)).toBe('25gp');
  });

  it('shows exactly what the Worker stores — one rule, two places', () => {
    // If these ever disagree, a shop reads one figure on screen and banks
    // another. Same inputs, same answer.
    for (const v of [25, 22.5, 0.5, 1239.9999999999998, 299.99999999999994, -30.5, 0]) {
      expect(money(v)).toBe(String(coin(v)) + 'gp');
    }
  });
});

describe('region wording', () => {
  it('defaults to Region, shown', () => {
    setRegion(null);
    expect(regionLabel()).toBe('Region');
    expect(regionWord()).toBe('region');
    expect(regionsOn()).toBe(true);
  });

  it('takes the realm’s own word for it', () => {
    setRegion({ regionLabel: 'Hold', showRegion: true });
    expect(regionLabel()).toBe('Hold');
    expect(regionWord()).toBe('hold');
    expect(regionsOn()).toBe(true);
  });

  it('can switch regions off entirely', () => {
    setRegion({ regionLabel: 'Sector', showRegion: false });
    expect(regionsOn()).toBe(false);
  });
});

/**
 * ONE LANGUAGE ON THE PAGE.
 *
 * The words and the dates were read from two different places: the interface
 * from a setting that started as English, the dates from `toLocaleDateString()`
 * with no locale, which asks the reader's SYSTEM. So an English interface on a
 * French machine printed "16 – 22 août" — two languages in one sentence.
 *
 * Both halves start from the DEVICE now, so by default they agree without
 * anyone choosing anything; a reader who overrules it in Appearance moves both.
 * What is pinned down here is that neither can be moved on its own.
 */
describe('dates', () => {
  // `globalThis.navigator` is getter-only under Node, so it is redefined rather
  // than assigned, and put back exactly as it was afterwards.
  const hadNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const stub = (tags, lang) => {
    Object.defineProperty(globalThis, 'navigator',
      { value: { languages: tags, language: tags[0] }, configurable: true });
    globalThis.localStorage = { getItem: () => lang, setItem: () => {} };
  };
  const restore = () => {
    if (hadNav) Object.defineProperty(globalThis, 'navigator', hadNav);
    else delete globalThis.navigator;
    delete globalThis.localStorage;
  };

  /** The device saying what it wants, with nothing chosen in Appearance. */
  const onDevice = (tags, fn) => { stub(tags, null); try { return fn(); } finally { restore(); } };
  /** A reader who has overruled their device in Appearance. */
  const asLang = (lang, fn, deviceTags) => {
    stub(deviceTags || [], lang);
    try { return fn(); } finally { restore(); }
  };

  it('come from the DEVICE when nobody has chosen a language', () => {
    expect(onDevice(['fr-FR'], () => formatDate('2026-08-16T12:00:00Z', { month: 'long' }))).toBe('août');
    expect(onDevice(['de-DE'], () => weekdayName(6))).toBe('Samstag');
    expect(onDevice(['es-MX'], () => weekdayName(1))).toBe('lunes');
  });

  it('take the device’s ORDER of preference, not just its first answer', () => {
    // Catalan first, Spanish second: we cannot write Catalan, so Spanish — the
    // best of what we have, in the reader's own order — beats falling to English.
    expect(onDevice(['ca-ES', 'es-ES', 'en'], () => weekdayName(1))).toBe('lunes');
  });

  it('fall back to English only when the device asks for nothing we write', () => {
    expect(onDevice(['ja-JP'], () => formatDate('2026-08-16T12:00:00Z', { month: 'long' }))).toBe('August');
    expect(onDevice([], () => weekdayName(6))).toBe('Saturday');
  });

  /**
   * The REGION is a second question. Two readers share every word on the page
   * and disagree about 16/8/2026, so within one language the device's own tag
   * decides — this is the whole reason the full tag is kept.
   */
  it('write the date the reader’s own way within one language', () => {
    const d = '2026-08-16T12:00:00Z';
    expect(onDevice(['en-US'], () => formatDate(d))).toBe('8/16/2026');
    expect(onDevice(['en-GB'], () => formatDate(d))).toBe('16/08/2026');
  });

  it('follow Appearance when a reader overrules their device — the bug, both ways', () => {
    // An English device told to render French gets French dates…
    expect(asLang('fr', () => formatDate('2026-08-16T12:00:00Z', { month: 'long' }), ['en-US'])).toBe('août');
    // …and a French device told to render English gets English ones.
    expect(asLang('en', () => formatDate('2026-08-16T12:00:00Z', { month: 'long' }), ['fr-FR'])).toBe('August');
  });

  /**
   * A chosen language the device did not ask for gets a sensible region for
   * THAT language — an American picking French reads French dates, not
   * American ones, because their region says nothing about how French is written.
   */
  it('ignore the device’s region once the language has been overruled', () => {
    expect(asLang('fr', () => formatDate('2026-08-16T12:00:00Z'), ['en-US'])).toBe('16/08/2026');
  });

  it('treat a stored language nothing knows as no choice at all', () => {
    expect(asLang('xx', () => formatDate('2026-08-16T12:00:00Z', { month: 'long' }), ['de-DE'])).toBe('August');
  });

  it('read an unusable date as nothing rather than as "Invalid Date"', () => {
    expect(formatDate('not a date')).toBe('');
    expect(formatDateTime(undefined)).toBe('');
    expect(weekdayName(9)).toBe('');
    expect(weekdayName('Tuesday')).toBe('');
  });

  it('take a Date or a string, since call sites hold both', () => {
    const d = new Date('2026-08-16T12:00:00Z');
    expect(formatDate(d, { month: 'long' })).toBe(formatDate('2026-08-16T12:00:00Z', { month: 'long' }));
  });
});
