/**
 * DEALING ONE FILLING INTO SEVERAL SPECIALS.
 *
 * The rule the register lives by is that a special asking for kinds is one
 * line each, because a line's parts are per unit and two fillings need not
 * divide evenly. The till asking three times for the same deal is the price of
 * that rule, and this is how it stops being paid: ask once for the whole
 * amount, then deal it out into fillings that each satisfy the deal alone.
 *
 * `specials.js` is pure and imports nothing, so it runs here — the same reason
 * `format.js` does.
 */
import { describe, it, expect } from 'vitest';
import { dealSpecial } from '../../src/lib/specials.js';

const FEAST = [{ tag: 'food', qty: 2 }, { tag: 'drink', qty: 2 }];
const units = (parts) => parts.reduce((n, p) => n + p.qty, 0);
const ofTag = (parts, tag) => parts.filter((p) => p.tag === tag).reduce((n, p) => n + p.qty, 0);

describe('one special', () => {
  it('hands back a single filling, unchanged', () => {
    const out = dealSpecial([
      { item: 'Stew', qty: 2, tag: 'food' },
      { item: 'Ale', qty: 2, tag: 'drink' },
    ], FEAST, 1);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual([
      { item: 'Stew', qty: 2, tag: 'food' },
      { item: 'Ale', qty: 2, tag: 'drink' },
    ]);
  });
});

describe('several of the same deal', () => {
  it('splits an even choice down the middle', () => {
    const out = dealSpecial([
      { item: 'Stew', qty: 4, tag: 'food' },
      { item: 'Ale', qty: 4, tag: 'drink' },
    ], FEAST, 2);
    expect(out).toHaveLength(2);
    out.forEach((line) => {
      expect(ofTag(line, 'food')).toBe(2);
      expect(ofTag(line, 'drink')).toBe(2);
    });
  });

  /**
   * The case the one-at-a-time rule exists for. Seven sweet rolls and three
   * stews fills "five food" twice, and there is no per-special half of it — so
   * the deal is uneven and both fillings are still exactly right.
   */
  it('splits an UNEVEN choice, which is the whole point', () => {
    const out = dealSpecial([
      { item: 'Sweet Roll', qty: 7, tag: 'food' },
      { item: 'Stew', qty: 3, tag: 'food' },
    ], [{ tag: 'food', qty: 5 }], 2);

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual([{ item: 'Sweet Roll', qty: 5, tag: 'food' }]);
    expect(out[1]).toEqual([
      { item: 'Sweet Roll', qty: 2, tag: 'food' },
      { item: 'Stew', qty: 3, tag: 'food' },
    ]);
    out.forEach((line) => expect(ofTag(line, 'food')).toBe(5));
  });

  it('never invents or loses a unit', () => {
    const chosen = [
      { item: 'Sweet Roll', qty: 5, tag: 'food' },
      { item: 'Stew', qty: 1, tag: 'food' },
      { item: 'Ale', qty: 5, tag: 'drink' },
      { item: 'Mead', qty: 1, tag: 'drink' },
    ];
    const out = dealSpecial(chosen, FEAST, 3);
    expect(out).toHaveLength(3);
    expect(out.reduce((n, line) => n + units(line), 0)).toBe(12);
    out.forEach((line) => {
      expect(ofTag(line, 'food')).toBe(2);
      expect(ofTag(line, 'drink')).toBe(2);
    });
  });

  it('deals each kind on its own — one kind’s split never constrains another', () => {
    const out = dealSpecial([
      { item: 'Stew', qty: 6, tag: 'food' },      // splits evenly
      { item: 'Ale', qty: 1, tag: 'drink' },      // these do not
      { item: 'Mead', qty: 5, tag: 'drink' },
    ], [{ tag: 'food', qty: 2 }, { tag: 'drink', qty: 2 }], 3);
    out.forEach((line) => {
      expect(ofTag(line, 'food')).toBe(2);
      expect(ofTag(line, 'drink')).toBe(2);
    });
    // The odd ale lands in the first filling, with a mead beside it.
    expect(out[0]).toContainEqual({ item: 'Ale', qty: 1, tag: 'drink' });
  });

  it('merges a kind chosen twice as the same item into one part', () => {
    const out = dealSpecial([
      { item: 'Stew', qty: 1, tag: 'food' },
      { item: 'Stew', qty: 1, tag: 'food' },
    ], [{ tag: 'food', qty: 2 }], 1);
    expect(out[0]).toEqual([{ item: 'Stew', qty: 2, tag: 'food' }]);
  });
});

describe('what it refuses', () => {
  it('a total that is not exactly the deal times the count', () => {
    const three = [{ item: 'Stew', qty: 3, tag: 'food' }];
    expect(() => dealSpecial(three, [{ tag: 'food', qty: 2 }], 2)).toThrow(/4 food needed — 3 chosen/);
    const five = [{ item: 'Stew', qty: 5, tag: 'food' }];
    expect(() => dealSpecial(five, [{ tag: 'food', qty: 2 }], 2)).toThrow(/4 food needed — 5 chosen/);
  });

  it('a kind the choice says nothing about', () => {
    expect(() => dealSpecial([{ item: 'Stew', qty: 2, tag: 'food' }], FEAST, 1))
      .toThrow(/2 drink needed — 0 chosen/);
  });

  it('a count that is not a count', () => {
    expect(() => dealSpecial([], FEAST, 0)).toThrow(/How many/i);
    expect(() => dealSpecial([], FEAST, -1)).toThrow(/How many/i);
  });
});
