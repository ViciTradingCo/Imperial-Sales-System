/**
 * Sale lines are stored as DATA, not as a sentence with a currency baked in.
 *
 * The regression this guards: sale rows used to be written as
 * "Iron Sword x2 @ 25gp", so a realm that renamed its money had permanently
 * wrong history and there was no way to re-render it.
 */
import { describe, it, expect } from 'vitest';
import { parseSaleItems, encodeSaleItems } from '../src/sales.js';

describe('sale line storage', () => {
  it('round-trips through JSON with no unit attached', () => {
    const lines = [{ name: 'Iron Sword', qty: 2, price: 25 }, { name: 'Health Potion', qty: 1, price: 5.5 }];
    const stored = encodeSaleItems(lines);
    expect(stored).not.toMatch(/gp/);
    expect(parseSaleItems(stored).lines).toEqual(lines);
  });

  it('still reads rows written before the change, unit and all', () => {
    const legacy = 'Iron Sword x2 @ 25gp, Health Potion x1 @ 5.5gp';
    expect(parseSaleItems(legacy).lines).toEqual([
      { name: 'Iron Sword', qty: 2, price: 25 },
      { name: 'Health Potion', qty: 1, price: 5.5 },
    ]);
  });

  it('reads the oldest "@ $30" form, and any other realm’s unit', () => {
    expect(parseSaleItems('Iron Sword x1 @ $30').lines).toEqual([{ name: 'Iron Sword', qty: 1, price: 30 }]);
    expect(parseSaleItems('Ration x3 @ 2credits').lines).toEqual([{ name: 'Ration', qty: 3, price: 2 }]);
  });

  it('counts what it cannot read instead of dropping it silently', () => {
    const r = parseSaleItems('Iron Sword x2 @ 25gp, something unreadable');
    expect(r.lines).toHaveLength(1);
    expect(r.unparsed).toBe(1);
  });

  it('survives malformed JSON without throwing', () => {
    expect(() => parseSaleItems('[{"name":')).not.toThrow();
    expect(parseSaleItems('').lines).toEqual([]);
  });
});
