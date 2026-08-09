/**
 * Messages of the Day.
 *
 * The global notice used to be ONE STRING in sys_flags — overwrite or clear,
 * nothing else. It is now a list of rows sharing the per-business table, with
 * an empty business meaning everyone. The rules that matter are about the two
 * kinds staying apart, the schedule being honoured, and the retired single
 * value surviving the change.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES, getFlag, setFlag } from '../src/db.js';
import {
  listGlobalMotds, addGlobalMotd, updateGlobalMotd, deleteGlobalMotd, activeGlobalNotices,
  listIndividualMotds, addIndividualMotd, updateIndividualMotd, deleteIndividualMotd, activeNoticesForBusiness,
  listMotdsForBusiness, addMotdForBusiness, updateMotdForBusiness, deleteMotdForBusiness,
} from '../src/motd.js';

let env;
const R = DEFAULT_REALM_ID;
const OTHER = 'rlm-motd-b';
const SHOP = 'Iron Hearth';
const LEGACY = 'motd_global:' + DEFAULT_REALM_ID;

const hoursFromNow = (h) => new Date(Date.now() + h * 3600000).toISOString();

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run();
  await env.DB.prepare('DELETE FROM sys_flags').run();
});

describe('global notices', () => {
  it('posts several at once, newest first', async () => {
    await addGlobalMotd(env, { message: 'First' }, R);
    await addGlobalMotd(env, { message: 'Second' }, R);
    const rows = await listGlobalMotds(env, R);
    expect(rows).toHaveLength(2);
    expect(rows[0].message).toBe('Second');
  });

  it('edits one without touching the others', async () => {
    await addGlobalMotd(env, { message: 'Keep me' }, R);
    await addGlobalMotd(env, { message: 'Typo heer' }, R);
    const typo = (await listGlobalMotds(env, R)).find((m) => m.message.startsWith('Typo'));
    await updateGlobalMotd(env, { id: typo.id, message: 'Typo here' }, R);
    expect((await listGlobalMotds(env, R)).map((m) => m.message).sort())
      .toEqual(['Keep me', 'Typo here']);
  });

  it('takes one down without disturbing the rest', async () => {
    await addGlobalMotd(env, { message: 'Stays' }, R);
    await addGlobalMotd(env, { message: 'Goes' }, R);
    const goes = (await listGlobalMotds(env, R)).find((m) => m.message === 'Goes');
    await deleteGlobalMotd(env, goes.id, R);
    expect(await activeGlobalNotices(env, R)).toEqual(['Stays']);
  });

  it('refuses an empty message rather than posting a blank banner', async () => {
    await expect(addGlobalMotd(env, { message: '   ' }, R)).rejects.toThrow(/enter a message/i);
  });

  it('honours the schedule', async () => {
    await addGlobalMotd(env, { message: 'Later', start: hoursFromNow(5) }, R);
    await addGlobalMotd(env, { message: 'Over', end: hoursFromNow(-5) }, R);
    await addGlobalMotd(env, { message: 'Now', start: hoursFromNow(-1), end: hoursFromNow(1) }, R);
    expect(await activeGlobalNotices(env, R)).toEqual(['Now']);
    // Scheduled ones are still MANAGEABLE — an admin has to be able to see and
    // edit a notice that has not started yet, which is the whole point of
    // scheduling one.
    expect(await listGlobalMotds(env, R)).toHaveLength(3);
  });

  it('stays inside its realm', async () => {
    await addGlobalMotd(env, { message: 'Ours' }, R);
    expect(await activeGlobalNotices(env, OTHER)).toEqual([]);
  });
});

describe('global and per-business notices share a table without mixing', () => {
  it('keeps each out of the other\'s list', async () => {
    await addGlobalMotd(env, { message: 'Everyone' }, R);
    await addIndividualMotd(env, { business: SHOP, message: 'Just them' }, R);
    expect((await listIndividualMotds(env, R)).map((m) => m.message)).toEqual(['Just them']);
    expect((await listGlobalMotds(env, R)).map((m) => m.message)).toEqual(['Everyone']);
  });

  it('does not show a global notice as one shop\'s own', async () => {
    await addGlobalMotd(env, { message: 'Everyone' }, R);
    expect(await activeNoticesForBusiness(env, SHOP, R)).toEqual([]);
    expect(await listMotdsForBusiness(env, SHOP, R)).toEqual([]);
  });

  it('will not edit or delete a shop\'s notice through the global endpoint', async () => {
    // Both live in one table, so an id ALONE would be enough to reach across.
    await addIndividualMotd(env, { business: SHOP, message: 'Theirs' }, R);
    const mine = (await listIndividualMotds(env, R))[0];
    await expect(updateGlobalMotd(env, { id: mine.id, message: 'Hijacked' }, R)).rejects.toThrow(/not found/i);
    await expect(deleteGlobalMotd(env, mine.id, R)).rejects.toThrow(/not found/i);
    expect((await listIndividualMotds(env, R))[0].message).toBe('Theirs');
  });

  it('will not reach a global notice through the individual endpoint either', async () => {
    await addGlobalMotd(env, { message: 'Everyone' }, R);
    const g = (await listGlobalMotds(env, R))[0];
    await expect(deleteIndividualMotd(env, g.id, R)).rejects.toThrow(/not found/i);
    await expect(updateIndividualMotd(env, { id: g.id, business: SHOP, message: 'Stolen' }, R))
      .rejects.toThrow(/not found/i);
    expect((await listGlobalMotds(env, R))[0].message).toBe('Everyone');
  });

  it('will not promote a shop\'s notice into a global one by blanking the business', async () => {
    await addIndividualMotd(env, { business: SHOP, message: 'Theirs' }, R);
    const m = (await listIndividualMotds(env, R))[0];
    await expect(updateIndividualMotd(env, { id: m.id, business: '', message: 'Theirs' }, R))
      .rejects.toThrow(/pick a business/i);
    expect(await listGlobalMotds(env, R)).toEqual([]);
  });
});

describe('the retired single-value global notice', () => {
  it('becomes a row the first time the list is read', async () => {
    await setFlag(env, LEGACY, 'Welcome to Skyrim');
    expect((await listGlobalMotds(env, R)).map((m) => m.message)).toEqual(['Welcome to Skyrim']);
    // And the flag is emptied, so it cannot be migrated a second time.
    expect(await getFlag(env, LEGACY)).toBe('');
  });

  it('migrates once, not on every read', async () => {
    await setFlag(env, LEGACY, 'Once only');
    await listGlobalMotds(env, R);
    await listGlobalMotds(env, R);
    await activeGlobalNotices(env, R);
    expect(await listGlobalMotds(env, R)).toHaveLength(1);
  });

  it('does not resurrect a notice the admin has taken down', async () => {
    // The guard is "no global rows yet", so deleting the last one must not look
    // like a realm that has never been migrated.
    await setFlag(env, LEGACY, 'Old news');
    const row = (await listGlobalMotds(env, R))[0];
    await deleteGlobalMotd(env, row.id, R);
    expect(await listGlobalMotds(env, R)).toEqual([]);
    expect(await activeGlobalNotices(env, R)).toEqual([]);
  });

  it('shows up in the banner without an admin having to visit the page', async () => {
    await setFlag(env, LEGACY, 'Still showing');
    expect(await activeGlobalNotices(env, R)).toEqual(['Still showing']);
  });
});

describe('a shop editing its own board', () => {
  it('changes the message and keeps the schedule it is given', async () => {
    await addMotdForBusiness(env, SHOP, { message: 'Restock Tusday', start: '2026-08-01' }, R);
    const n = (await listMotdsForBusiness(env, SHOP, R))[0];
    await updateMotdForBusiness(env, SHOP, { id: n.id, message: 'Restock Tuesday', start: '2026-08-01' }, R);
    const after = (await listMotdsForBusiness(env, SHOP, R))[0];
    expect(after).toMatchObject({ message: 'Restock Tuesday', start: '2026-08-01' });
    expect(after.id).toBe(n.id);
  });

  it('cannot touch another shop\'s notice', async () => {
    await addMotdForBusiness(env, SHOP, { message: 'Ours' }, R);
    const n = (await listMotdsForBusiness(env, SHOP, R))[0];
    await expect(updateMotdForBusiness(env, 'Rift Traders', { id: n.id, message: 'Theirs now' }, R))
      .rejects.toThrow(/not found/i);
    await expect(deleteMotdForBusiness(env, 'Rift Traders', n.id, R)).rejects.toThrow(/not found/i);
  });

  it('refuses to blank a notice out through the edit', async () => {
    await addMotdForBusiness(env, SHOP, { message: 'Something' }, R);
    const n = (await listMotdsForBusiness(env, SHOP, R))[0];
    await expect(updateMotdForBusiness(env, SHOP, { id: n.id, message: '' }, R)).rejects.toThrow(/enter a message/i);
  });
});
