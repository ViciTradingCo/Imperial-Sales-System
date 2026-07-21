/**
 * Unit tests for the pure backend logic (no D1 / Sheets needed): the item-index
 * fuzzy matcher and the sale-summary parser — the two places where bad data
 * would silently corrupt the ledger or the market.
 */
import { describe, it, expect } from 'vitest';
import { normalizeItem, matchMasterItem } from '../src/item-index.js';
import { parseSaleItems } from '../src/sales.js';

describe('normalizeItem', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeItem('  Iron   Sword! ')).toBe('iron sword');
    expect(normalizeItem('Health-Potion')).toBe('health potion');
    expect(normalizeItem('')).toBe('');
    expect(normalizeItem(null)).toBe('');
  });
});

describe('matchMasterItem', () => {
  const master = [
    { name: 'Iron Sword', baseValue: 30 },
    { name: 'Health Potion', baseValue: 5 },
    { name: 'Steel Dagger', baseValue: 20 },
  ];

  it('matches exactly, ignoring case and spacing', () => {
    expect(matchMasterItem('iron sword', master).name).toBe('Iron Sword');
    expect(matchMasterItem('  Iron   Sword ', master).name).toBe('Iron Sword');
  });

  it('tolerates small typos / grammar drift', () => {
    expect(matchMasterItem('Iron Swrod', master).name).toBe('Iron Sword');
    expect(matchMasterItem('Helth Potion', master).name).toBe('Health Potion');
  });

  it('returns null for genuinely new items', () => {
    expect(matchMasterItem('Dragonbone Warhammer', master)).toBeNull();
    expect(matchMasterItem('', master)).toBeNull();
  });

  it('holds short names to a tight tolerance', () => {
    const m = [{ name: 'Axe', baseValue: 10 }];
    expect(matchMasterItem('Axes', m).name).toBe('Axe'); // 1 edit, allowed
    expect(matchMasterItem('Bow', m)).toBeNull();        // 3 edits, rejected
  });
});

describe('parseSaleItems', () => {
  it('parses the canonical "Name xQty @ Ngp" summary', () => {
    const r = parseSaleItems('Iron Sword x2 @ 30gp, Health Potion x1 @ 5gp');
    expect(r.lines).toEqual([
      { name: 'Iron Sword', qty: 2, price: 30 },
      { name: 'Health Potion', qty: 1, price: 5 },
    ]);
    expect(r.unparsed).toBe(0);
  });

  it('tolerates the legacy "@ $N" form (for voiding old rows)', () => {
    const r = parseSaleItems('Iron Sword x2 @ $30');
    expect(r.lines[0]).toEqual({ name: 'Iron Sword', qty: 2, price: 30 });
  });

  it('counts unparseable segments without throwing', () => {
    const r = parseSaleItems('garbage, Iron Sword x1 @ 5gp');
    expect(r.unparsed).toBe(1);
    expect(r.lines).toHaveLength(1);
  });

  it('handles empty / null input', () => {
    expect(parseSaleItems('')).toEqual({ lines: [], unparsed: 0 });
    expect(parseSaleItems(null)).toEqual({ lines: [], unparsed: 0 });
  });
});
