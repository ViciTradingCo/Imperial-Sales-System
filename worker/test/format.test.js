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
import { money, setCurrency, currency, setRegion, regionLabel, regionWord, regionsOn } from '../../src/lib/format.js';
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
