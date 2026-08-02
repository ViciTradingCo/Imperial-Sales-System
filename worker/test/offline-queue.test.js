/**
 * The register's offline queue. Pure functions over localStorage, so they test
 * cleanly with a stub — and they badly need testing: the realm/shop guard added
 * here decides whether a queued sale posts into the right world's books.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { enqueueSale, flushSales, queuedCount, isNetworkError } from '../../src/lib/offline-queue.js';

// Minimal localStorage — the queue only uses getItem/setItem.
beforeEach(() => {
  let store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
});

const ANN = { homeRealm: 'default', business: 'Iron Hearth' };
const sale = (n) => ({ cart: [{ item: 'Iron Sword', qty: n, price: 10 }], idempotencyKey: 'k' + n });

describe('offline queue', () => {
  it('counts what it holds and replays in order', async () => {
    enqueueSale(sale(1), ANN);
    enqueueSale(sale(2), ANN);
    expect(queuedCount()).toBe(2);

    const seen = [];
    const res = await flushSales(async (s) => { seen.push(s.idempotencyKey); }, ANN);
    expect(res.flushed).toBe(2);
    expect(res.remaining).toBe(0);
    expect(seen).toEqual(['k1', 'k2']);
    expect(queuedCount()).toBe(0);
  });

  it('keeps everything from the first network failure onward', async () => {
    enqueueSale(sale(1), ANN);
    enqueueSale(sale(2), ANN);
    enqueueSale(sale(3), ANN);
    const fn = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('Could not reach the API at https://x'));

    const res = await flushSales(fn, ANN);
    expect(res.flushed).toBe(1);
    // The failed sale and the one after it are both still queued.
    expect(res.remaining).toBe(2);
    expect(queuedCount()).toBe(2);
  });

  it('drops a permanently rejected sale and carries on', async () => {
    enqueueSale(sale(1), ANN);
    enqueueSale(sale(2), ANN);
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Not enough stock for Iron Sword.'))
      .mockResolvedValueOnce(undefined);

    const res = await flushSales(fn, ANN);
    expect(res.flushed).toBe(1);   // the second went through
    expect(res.remaining).toBe(0); // the first is gone for good — it can never succeed
  });

  /**
   * The reason the stamp exists: a sale rung up in one realm must not post into
   * another just because the session moved before the network came back.
   */
  it('holds a sale whose realm no longer matches the session', async () => {
    enqueueSale(sale(1), { homeRealm: 'rlm-other', business: 'Iron Hearth' });
    enqueueSale(sale(2), ANN);

    const seen = [];
    const res = await flushSales(async (s) => { seen.push(s.idempotencyKey); }, ANN);
    expect(res.flushed).toBe(1);
    expect(seen).toEqual(['k2']);       // only this session's sale was sent
    expect(res.held).toBe(1);
    expect(queuedCount()).toBe(1);      // the other realm's sale is still waiting
  });

  it('holds a sale rung up at a different shop in the same realm', async () => {
    enqueueSale(sale(1), { homeRealm: 'default', business: 'Other Shop' });
    const res = await flushSales(async () => {}, ANN);
    expect(res.flushed).toBe(0);
    expect(res.held).toBe(1);
  });

  it('replays an unstamped entry from before the guard existed', async () => {
    // Written by an older build: no realmId, no business.
    localStorage.setItem('eec.offline.sales', JSON.stringify([{ sale: sale(9), at: Date.now() }]));
    const res = await flushSales(async () => {}, ANN);
    expect(res.flushed).toBe(1);
    expect(res.held).toBe(0);
  });

  it('tells a network failure apart from a rejection', () => {
    expect(isNetworkError(new Error('Could not reach the API at https://x'))).toBe(true);
    expect(isNetworkError(new Error('Failed to fetch'))).toBe(true);
    expect(isNetworkError(new Error('Not enough stock for Iron Sword.'))).toBe(false);
  });
});
