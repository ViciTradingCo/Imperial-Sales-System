/**
 * How amounts are printed.
 *
 * Trade is in whole coins, so a ledger must read "1240gp", not "1240.00gp" —
 * and it must read "1240gp" even when the sum it was handed carries a floating
 * point tail, which is what summing money in JavaScript produces. A fractional
 * amount still prints both places, because there the decimal is real.
 *
 * The frontend has no test runner of its own; format.js is pure and imports
 * nothing, so it runs here.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { money, setCurrency, currency, setRegion, regionLabel, regionWord, regionsOn } from '../../src/lib/format.js';

beforeEach(() => setCurrency('gp'));

describe('money', () => {
  it('prints whole amounts without decimals', () => {
    expect(money(25)).toBe('25gp');
    expect(money(0)).toBe('0gp');
    expect(money(1240)).toBe('1240gp');
    expect(money(-30)).toBe('-30gp');
  });

  it('keeps the decimals when the amount actually has them', () => {
    expect(money(22.5)).toBe('22.50gp');   // 10% off 25
    expect(money(21.25)).toBe('21.25gp');  // 15% off 25
    expect(money(0.5)).toBe('0.50gp');
  });

  it('does not let a float tail print', () => {
    // The reason the rounding has to come first: these are the shapes a summed
    // day of takings actually arrives in.
    expect(money(0.1 + 0.2)).toBe('0.30gp');
    expect(money(1240.0000000000002)).toBe('1240gp');
    expect(money(299.99999999999994)).toBe('300gp');
    expect(money(1240.005000000001)).toBe('1240.01gp');
  });

  it('rounds to the coin rather than truncating', () => {
    expect(money(12.344)).toBe('12.34gp');
    expect(money(12.346)).toBe('12.35gp');
    expect(money(12.999)).toBe('13gp');
  });

  it('treats nonsense as nothing rather than printing NaN', () => {
    expect(money(undefined)).toBe('0gp');
    expect(money(null)).toBe('0gp');   // Number(null) is 0
    expect(money('abc')).toBe('0gp');
    expect(money(Infinity)).toBe('0gp');
  });

  it('reads a numeric string, since that is what a form field gives', () => {
    expect(money('25')).toBe('25gp');
    expect(money('22.50')).toBe('22.50gp');
  });

  it("uses the realm's denomination", () => {
    setCurrency('septims');
    expect(money(25)).toBe('25septims');
    expect(currency()).toBe('septims');
    setCurrency('');           // empty falls back rather than printing bare
    expect(money(25)).toBe('25gp');
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
