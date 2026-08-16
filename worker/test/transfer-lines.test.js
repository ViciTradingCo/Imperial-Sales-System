/**
 * A transfer is a SHIPMENT — several items sent, accepted or refused as one.
 *
 * The one-item case is covered in integration.test.js, along with the rule that
 * matters most: stock is conserved through every path. What is asserted here is
 * what having MORE THAN ONE line changes.
 *
 * Nothing may half-happen. A shipment whose fourth line is short must leave the
 * first three on the sender's shelf, because a crate that arrives missing its
 * last item with no record saying so is worse than one that never left. And
 * accepting must land every line, not the first: the receiver pressed one
 * button on one crate.
 *
 * And a row written before shipments existed must still read, still be
 * accepted, and still restock exactly what it took.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import {
  createTransfer, listTransfers, acceptTransfer, declineTransfer, cancelTransfer,
  listTransferHistory, transferLines, transferSummary,
} from '../src/transfers.js';

let env;
const R = DEFAULT_REALM_ID;
const A = 'Alpha';
const B = 'Beta';

const seed = (business, item, price, stock) => env.DB.prepare(
  'INSERT INTO inventory (realm_id, business, item, price, stock, low_stock) VALUES (?, ?, ?, ?, ?, 0)')
  .bind(R, business, item, price, stock).run();

const stockOf = async (business, item) => {
  const r = await env.DB.prepare('SELECT stock FROM inventory WHERE realm_id = ? AND business = ? AND item = ?')
    .bind(R, business, item).first();
  return r ? r.stock : null;
};

const priceOf = async (business, item) => {
  const r = await env.DB.prepare('SELECT price FROM inventory WHERE realm_id = ? AND business = ? AND item = ?')
    .bind(R, business, item).first();
  return r ? r.price : null;
};

/** A crate of three different things, as the sender's shelf allows. */
const CRATE = [{ item: 'Iron Sword', qty: 2 }, { item: 'Ale', qty: 5 }, { item: 'Rope', qty: 1 }];

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run();
  await seed(A, 'Iron Sword', 30, 10);
  await seed(A, 'Ale', 5, 20);
  await seed(A, 'Rope', 2, 4);
});

describe('sending a crate', () => {
  it('debits every line at once and holds them as one shipment', async () => {
    await createTransfer(env, A, { toBusiness: B, items: CRATE }, R);
    expect(await stockOf(A, 'Iron Sword')).toBe(8);
    expect(await stockOf(A, 'Ale')).toBe(15);
    expect(await stockOf(A, 'Rope')).toBe(3);

    const { outgoing } = await listTransfers(env, A, R);
    expect(outgoing).toHaveLength(1); // ONE shipment, not three transfers
    expect(outgoing[0].lines).toEqual([
      { item: 'Iron Sword', qty: 2, price: 30 },
      { item: 'Ale', qty: 5, price: 5 },
      { item: 'Rope', qty: 1, price: 2 },
    ]);
    expect(outgoing[0].units).toBe(8);
    expect(outgoing[0].summary).toBe('Iron Sword ×2 + 2 more');
  });

  it('nothing at all when one line is short', async () => {
    await expect(createTransfer(env, A, {
      toBusiness: B, items: [...CRATE, { item: 'Rope', qty: 99 }],
    }, R)).rejects.toThrow(/not enough rope/i);
    // The three good lines stayed on the shelf.
    expect(await stockOf(A, 'Iron Sword')).toBe(10);
    expect(await stockOf(A, 'Ale')).toBe(20);
    expect(await stockOf(A, 'Rope')).toBe(4);
    expect((await listTransfers(env, A, R)).outgoing).toEqual([]);
  });

  it('nothing at all when one line names something the shop does not stock', async () => {
    await expect(createTransfer(env, A, {
      toBusiness: B, items: [{ item: 'Ale', qty: 1 }, { item: 'Moon Sugar', qty: 1 }],
    }, R)).rejects.toThrow(/not found in your inventory: Moon Sugar/i);
    expect(await stockOf(A, 'Ale')).toBe(20);
  });

  it('says WHICH line is wrong when a quantity is missing', async () => {
    await expect(createTransfer(env, A, {
      toBusiness: B, items: [{ item: 'Ale', qty: 1 }, { item: 'Rope', qty: 0 }],
    }, R)).rejects.toThrow(/item 2/i);
  });

  /**
   * Two lines for the same item are ADDED UP before the shelf is checked.
   * Checked line by line, 5 and 5 against a stock of 8 both pass and the shelf
   * goes to −2 with nobody told.
   */
  it('folds repeated items together rather than checking them apart', async () => {
    await expect(createTransfer(env, A, {
      toBusiness: B, items: [{ item: 'Rope', qty: 3 }, { item: 'Rope', qty: 3 }],
    }, R)).rejects.toThrow(/not enough rope \(have 4, transferring 6\)/i);
    expect(await stockOf(A, 'Rope')).toBe(4);

    await createTransfer(env, A, { toBusiness: B, items: [{ item: 'Rope', qty: 1 }, { item: 'rope', qty: 2 }] }, R);
    expect(await stockOf(A, 'Rope')).toBe(1);
    const { outgoing } = await listTransfers(env, A, R);
    expect(outgoing[0].lines).toEqual([{ item: 'Rope', qty: 3, price: 2 }]); // one line, in the shelf's spelling
  });

  it('still takes the shape a page from before shipments would send', async () => {
    await createTransfer(env, A, { toBusiness: B, item: 'Ale', qty: 4 }, R);
    expect(await stockOf(A, 'Ale')).toBe(16);
    const { outgoing } = await listTransfers(env, A, R);
    expect(outgoing[0].lines).toEqual([{ item: 'Ale', qty: 4, price: 5 }]);
    expect(outgoing[0].summary).toBe('Ale ×4');
  });

  it('is idempotent for the whole crate, not line by line', async () => {
    await createTransfer(env, A, { toBusiness: B, items: CRATE, idempotencyKey: 'k1' }, R);
    await createTransfer(env, A, { toBusiness: B, items: CRATE, idempotencyKey: 'k1' }, R);
    expect(await stockOf(A, 'Iron Sword')).toBe(8);
    expect(await stockOf(A, 'Ale')).toBe(15);
    expect((await listTransfers(env, A, R)).outgoing).toHaveLength(1);
  });
});

describe('what the receiver does with it', () => {
  const send = () => createTransfer(env, A, { toBusiness: B, items: CRATE }, R);
  const incomingId = async () => (await listTransfers(env, B, R)).incoming[0].id;

  it('accepting lands every line, at the sender’s price, creating the listings', async () => {
    await send();
    await acceptTransfer(env, B, await incomingId(), R);
    expect(await stockOf(B, 'Iron Sword')).toBe(2);
    expect(await stockOf(B, 'Ale')).toBe(5);
    expect(await stockOf(B, 'Rope')).toBe(1);
    expect(await priceOf(B, 'Ale')).toBe(5);
    // Conserved: what left Alpha is what arrived at Beta, item by item.
    expect(await stockOf(A, 'Ale')).toBe(15);
    expect((await listTransfers(env, B, R)).incoming).toEqual([]);
  });

  it('accepting adds to a listing the receiver already had', async () => {
    await seed(B, 'Ale', 9, 3);
    await send();
    await acceptTransfer(env, B, await incomingId(), R);
    expect(await stockOf(B, 'Ale')).toBe(8);
    expect(await priceOf(B, 'Ale')).toBe(9); // their own price stands
  });

  it('declining returns every line to the sender', async () => {
    await send();
    await declineTransfer(env, B, await incomingId(), R);
    expect(await stockOf(A, 'Iron Sword')).toBe(10);
    expect(await stockOf(A, 'Ale')).toBe(20);
    expect(await stockOf(A, 'Rope')).toBe(4);
    expect(await stockOf(B, 'Ale')).toBe(null); // never arrived
  });

  it('cancelling returns every line to the sender', async () => {
    await send();
    const { outgoing } = await listTransfers(env, A, R);
    await cancelTransfer(env, A, outgoing[0].id, R);
    expect(await stockOf(A, 'Iron Sword')).toBe(10);
    expect(await stockOf(A, 'Ale')).toBe(20);
    expect(await stockOf(A, 'Rope')).toBe(4);
  });

  it('lists the crate in both shops’ history, from each side', async () => {
    await send();
    await acceptTransfer(env, B, await incomingId(), R);
    const mine = await listTransferHistory(env, A, R);
    const theirs = await listTransferHistory(env, B, R);
    expect(mine[0]).toMatchObject({ dir: 'out', to: B, units: 8, status: 'accepted' });
    expect(theirs[0]).toMatchObject({ dir: 'in', from: A, units: 8, status: 'accepted' });
    expect(mine[0].lines).toHaveLength(3);
  });
});

/**
 * Rows written before shipments existed have `items` NULL and their single line
 * in the old columns. They must go on working — a pending transfer sent the
 * day before this deployed is somebody's goods, in limbo until it is accepted.
 */
describe('a transfer from before shipments', () => {
  const legacy = () => env.DB.prepare(
    `INSERT INTO transfers (realm_id, from_business, to_business, item, qty, price, status, ts)
     VALUES (?, ?, ?, 'Ale', 6, 5, 'pending', ?)`).bind(R, A, B, new Date().toISOString()).run();

  it('reads as a one-line shipment', async () => {
    await legacy();
    const { incoming } = await listTransfers(env, B, R);
    expect(incoming[0].lines).toEqual([{ item: 'Ale', qty: 6, price: 5 }]);
    expect(incoming[0].units).toBe(6);
  });

  it('can still be accepted, and lands its goods', async () => {
    await legacy();
    const { incoming } = await listTransfers(env, B, R);
    await acceptTransfer(env, B, incoming[0].id, R);
    expect(await stockOf(B, 'Ale')).toBe(6);
  });

  it('can still be declined, and returns its goods', async () => {
    await legacy();
    const { incoming } = await listTransfers(env, B, R);
    await declineTransfer(env, B, incoming[0].id, R);
    expect(await stockOf(A, 'Ale')).toBe(26); // the 20 seeded plus the 6 coming back
  });

  // Unreadable JSON must not lose the goods: the row still has its old columns.
  it('falls back to the columns when items is not JSON', () => {
    expect(transferLines({ items: '{not json', item: 'Ale', qty: 2, price: 5 }))
      .toEqual([{ item: 'Ale', qty: 2, price: 5 }]);
  });
});

describe('how a crate reads in one line', () => {
  it('names the item when there is one, and counts the rest when there are more', () => {
    expect(transferSummary([{ item: 'Ale', qty: 3 }])).toBe('Ale ×3');
    expect(transferSummary([{ item: 'Ale', qty: 3 }, { item: 'Rope', qty: 1 }])).toBe('Ale ×3 + 1 more');
    expect(transferSummary([])).toBe('');
  });
});
