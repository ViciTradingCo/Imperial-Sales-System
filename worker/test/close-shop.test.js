/**
 * AN OWNER CLOSING THEIR OWN SHOP.
 *
 * The whole promise of the feature is in its two halves disagreeing: the shop
 * ends, and its books do not. So what has to hold is
 *   • the company leaves the roster and its people leave with it;
 *   • every sale, delivery, coffer entry and time card is STILL THERE, and
 *     still attributable — an owner settling a departed employee afterwards is
 *     the same code path as anyone else leaving;
 *   • the name is freed, so someone else may take it without inheriting a
 *     stranger's history;
 *   • and an admin can put the whole thing back, because "you cannot undo this
 *     yourself" is what the screen promises, not "this cannot be undone".
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { registerUser, findBusinessByName, closeCompany, restoreCompany,
  listCompanies, listArchivedCompanies } from '../src/registry.js';
import { listUsersByBusiness, findUserByEmail } from '../src/users.js';
import { shopShifts, markPaid, clockIn, clockOut } from '../src/timecard.js';

let env;
const R = DEFAULT_REALM_ID;
const SHOP = 'The Bannered Mare';

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of REALM_TABLES) await env.DB.prepare('DELETE FROM ' + t).run();
  await registerUser(env, { email: 'own@x.com', character: 'Hulda', businessName: SHOP, asOwner: true, realmId: R });
  await registerUser(env, { email: 'emp@x.com', character: 'Saadia', businessName: SHOP, asOwner: false, realmId: R });
});

/** A day's trade: a sale, a delivery, a coffer line and a finished shift. */
async function trade(uid) {
  const ts = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO sales (realm_id, business, ts, order_no, items, qty_total, total, employee, employee_uid, commission, status)
     VALUES (?, ?, ?, 'ORD-1', '[]', 3, 45, 'Saadia', ?, 5, '')`).bind(R, SHOP, ts, uid).run();
  await env.DB.prepare(
    `INSERT INTO intake (realm_id, business, ts, item, num_items, price_per, vendor, source_hold)
     VALUES (?, ?, ?, 'Ale', 20, 3, 'Honningbrew', 'Whiterun')`).bind(R, SHOP, ts).run();
  await env.DB.prepare(
    `INSERT INTO coffer_entries (realm_id, business, ts, kind, amount, note) VALUES (?, ?, ?, 'sale', 45, 'ORD-1')`)
    .bind(R, SHOP, ts).run();
  await clockIn(env, { uid, employee: 'Saadia', business: SHOP, rate: 5 }, R);
  await env.DB.prepare('UPDATE time_card SET clock_in = ? WHERE uid = ? AND clock_out IS NULL')
    .bind(new Date(Date.now() - 4 * 3600000).toISOString(), uid).run();
  await clockOut(env, { uid, rate: 5 }, R);
}

const countIn = async (table) => {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM ' + table + ' WHERE realm_id = ?').bind(R).first();
  return (r && r.n) || 0;
};

describe('closing a shop', () => {
  it('takes the company off the roster and releases everyone on it', async () => {
    const res = await closeCompany(env, SHOP, R);
    expect(res).toMatchObject({ business: SHOP, released: 2 });
    expect(await findBusinessByName(env, SHOP, R)).toBeFalsy();
    expect(await findUserByEmail(env, 'own@x.com')).toBe(null);
    expect(await findUserByEmail(env, 'emp@x.com')).toBe(null);
    expect(await listUsersByBusiness(env, SHOP, R)).toEqual([]);
  });

  /** The point of the whole feature. Nothing is deleted, only moved aside. */
  it('KEEPS every row the shop wrote', async () => {
    const saadia = await findUserByEmail(env, 'emp@x.com');
    await trade(saadia.uid);
    await closeCompany(env, SHOP, R);

    expect(await countIn('sales')).toBe(1);
    expect(await countIn('intake')).toBe(1);
    expect(await countIn('coffer_entries')).toBe(1);
    expect(await countIn('time_card')).toBe(1);
    // The company row is there too — archived, not gone, and still remembering
    // what it was called.
    expect(await listCompanies(env, R)).toEqual([]);
    const archived = await listArchivedCompanies(env, R);
    expect(archived).toHaveLength(1);
    expect(archived[0].archivedFrom).toBe(SHOP);
  });

  /**
   * A closed shop still owes what it owed. The rows carry the BUSINESS, and the
   * archive renames the business, so the debt travels with them rather than
   * being orphaned at a name nothing answers to.
   */
  it('leaves what it owed settleable under the archived name', async () => {
    const saadia = await findUserByEmail(env, 'emp@x.com');
    await trade(saadia.uid);
    await closeCompany(env, SHOP, R);

    const archived = (await listArchivedCompanies(env, R))[0].business;
    const owed = (await shopShifts(env, archived, R)).people.find((p) => p.uid === saadia.uid);
    expect(owed.owed).toBe(25); // 4h at 5, plus 5 commission
    expect(owed.employee).toBe('Saadia'); // still named, though nobody works there
    const after = await markPaid(env, { business: archived, uid: saadia.uid }, R);
    expect(after.people.find((p) => p.uid === saadia.uid).owed).toBe(0);
  });

  /** The name is the shop's, not the history's — someone else may have it. */
  it('frees the name, and the new shop inherits none of the old one’s trade', async () => {
    const saadia = await findUserByEmail(env, 'emp@x.com');
    await trade(saadia.uid);
    await closeCompany(env, SHOP, R);

    await registerUser(env, { email: 'new@x.com', character: 'Ysolda', businessName: SHOP, asOwner: true, realmId: R });
    expect((await findBusinessByName(env, SHOP, R)).businessName).toBe(SHOP);
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM sales WHERE realm_id = ? AND business = ?')
      .bind(R, SHOP).first();
    expect(rows.n).toBe(0);
  });

  /** "You cannot undo this" is about the OWNER, not about the system. */
  it('can be undone by an admin, shop and books together', async () => {
    const saadia = await findUserByEmail(env, 'emp@x.com');
    await trade(saadia.uid);
    await closeCompany(env, SHOP, R);

    const archived = (await listArchivedCompanies(env, R))[0];
    await restoreCompany(env, archived.id, R);
    const back = await findBusinessByName(env, SHOP, R);
    expect(back.businessName).toBe(SHOP);
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM sales WHERE realm_id = ? AND business = ?')
      .bind(R, SHOP).first();
    expect(rows.n).toBe(1);
  });

  it('refuses a shop that is not there, and a shop with no name', async () => {
    await expect(closeCompany(env, 'The Drunken Huntsman', R)).rejects.toThrow(/not in the registry/);
    await expect(closeCompany(env, '   ', R)).rejects.toThrow(/Which shop/);
  });

  /** Realm isolation: one realm's closure must not reach into another's. */
  it('leaves a same-named shop in another realm alone', async () => {
    await env.DB.prepare("INSERT INTO realms (id, name) VALUES ('r2', 'Second')").run();
    await registerUser(env, { email: 'other@x.com', character: 'Mralki', businessName: SHOP, asOwner: true, realmId: 'r2' });
    await closeCompany(env, SHOP, R);
    expect((await findBusinessByName(env, SHOP, 'r2')).businessName).toBe(SHOP);
    expect((await findUserByEmail(env, 'other@x.com')).business).toBe(SHOP);
  });
});
