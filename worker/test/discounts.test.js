/**
 * Discounts and upcharges — one signed percent.
 *
 * Positive takes money off, negative puts it on. One row shape and one sum, so
 * an upcharge cannot be the case some later branch forgot; what needs asserting
 * is that the storage really is signed, the words really are derived from the
 * sign, and the bounds are the two different bounds these two directions need.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { listDiscounts, addDiscount, deleteDiscount, adjustmentLabel } from '../src/discounts.js';

let env;
const R = DEFAULT_REALM_ID;
const SHOP = 'Iron Hearth';

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => { for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run(); });

describe('storing them', () => {
  it('keeps a discount positive and an upcharge negative', async () => {
    await addDiscount(env, SHOP, { name: 'Regular', percent: 10 }, R);
    await addDiscount(env, SHOP, { name: 'Rush job', percent: -25 }, R);
    const rows = await listDiscounts(env, SHOP, R);
    expect(rows.map((r) => [r.name, r.percent])).toEqual([['Regular', 10], ['Rush job', -25]]);
  });

  it('refuses a discount over 100% — you cannot take off more than the price', async () => {
    await expect(addDiscount(env, SHOP, { name: 'Silly', percent: 101 }, R)).rejects.toThrow(/more than 100/);
  });

  it('allows an upcharge well past 100%, up to the stated ceiling', async () => {
    await addDiscount(env, SHOP, { name: 'Triple', percent: -200 }, R);
    expect((await listDiscounts(env, SHOP, R))[0].percent).toBe(-200);
    await expect(addDiscount(env, SHOP, { name: 'Absurd', percent: -1001 }, R)).rejects.toThrow(/cannot be more than 1000/);
  });

  it('refuses 0 — an adjustment that adjusts nothing is a mistake', async () => {
    await expect(addDiscount(env, SHOP, { name: 'Nothing', percent: 0 }, R)).rejects.toThrow(/Enter a percentage/);
  });

  it('refuses a nameless one', async () => {
    await expect(addDiscount(env, SHOP, { name: '  ', percent: 10 }, R)).rejects.toThrow(/Enter a name/);
  });

  it('will not take the same name twice, whichever direction it goes', async () => {
    await addDiscount(env, SHOP, { name: 'Guild', percent: 10 }, R);
    await expect(addDiscount(env, SHOP, { name: 'Guild', percent: -10 }, R)).rejects.toThrow(/already exists/);
  });

  it('deletes one without disturbing the other', async () => {
    await addDiscount(env, SHOP, { name: 'Regular', percent: 10 }, R);
    const [row] = await listDiscounts(env, SHOP, R);
    await addDiscount(env, SHOP, { name: 'Rush job', percent: -25 }, R);
    const left = await deleteDiscount(env, SHOP, row.id, R);
    expect(left.map((r) => r.name)).toEqual(['Rush job']);
  });

  it('never leaks between realms', async () => {
    await addDiscount(env, SHOP, { name: 'Regular', percent: 10 }, R);
    expect(await listDiscounts(env, SHOP, 'rlm-other')).toEqual([]);
  });
});

describe('how it reads', () => {
  it('writes a discount as a plain percentage', () => {
    expect(adjustmentLabel(20, 'Regular')).toBe('Regular (20%)');
  });

  it('writes an upcharge in words, never as a minus sign', () => {
    expect(adjustmentLabel(-20, 'Rush job')).toBe('Rush job (20% surcharge)');
  });

  it('copes with no name', () => {
    expect(adjustmentLabel(-20, '')).toBe('(20% surcharge)');
    expect(adjustmentLabel(15)).toBe('(15%)');
  });

  it('says nothing at all for no adjustment', () => {
    expect(adjustmentLabel(0, 'Ignored')).toBe('');
  });
});
