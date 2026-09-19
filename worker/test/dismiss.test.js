/**
 * AN OWNER PUTTING SOMEBODY OUT.
 *
 * Firing is leaving decided by the other party, and it has to end the same way,
 * so the promises are the same two: the membership goes and THE DEBT DOES NOT.
 * A shop that could clear its wage bill by dismissing the people it owed would
 * be a shop with a reason to dismiss them.
 *
 * The rest is the boundary, which is where a roster button of this kind goes
 * wrong. It goes through the ROUTES, not the module, because the gates are the
 * thing being tested — and this permission depends on BOTH sides, so it is the
 * pairs that matter rather than a list of who is allowed in:
 *
 *   • the OWNER may dismiss an employee and a manager alike;
 *   • a MANAGER may dismiss an ordinary EMPLOYEE — and no one else: not another
 *     manager, not themselves, which would be the same power by another door;
 *   • an EMPLOYEE may dismiss nobody;
 *   • nobody may reach into ANOTHER shop's roster with a borrowed uid;
 *   • the OWNER cannot be dismissed, by themselves or anybody else;
 *   • somebody still clocked in is refused, or their shift outlives them.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { ensureDefaultRealm } from '../src/realm.js';
import { registerUser } from '../src/registry.js';
import { listUsersByBusiness, findUserByEmail, setManagerRole, appendUser } from '../src/users.js';
import { createSession } from '../src/sessions.js';
import { clockIn, clockOut, shopShifts, markPaid } from '../src/timecard.js';
import { dismissalRefusal } from '../src/guards.js';
import { routes as businessRoutes } from '../src/routes/business.js';
import { cacheBust } from '../src/cache.js';

let env;
const R = DEFAULT_REALM_ID;
const SHOP = 'The Forge';
const RIVAL = 'Riverwood Trader';
const PATH = '/business/employees/dismiss';

const req = (token) => ({ headers: { get: (h) => (h === 'Authorization' ? 'Bearer ' + token : null) } });
const route = (method) => businessRoutes.find((r) => r.method === method && r.path === PATH);
const preview = (token, uid) => route('GET').handler({
  request: req(token), env, body: {},
  url: new URL('https://x' + PATH + '?uid=' + encodeURIComponent(uid)),
});
const fire = (token, uid, extra) => route('POST').handler({
  request: req(token), env, body: { uid, confirm: true, ...(extra || {}) }, url: new URL('https://x' + PATH),
});

let token = {};
let uid = {};

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: 'boss@x.test' }; await ensureSchema(env); });
beforeEach(async () => {
  for (const t of [...REALM_TABLES, 'realms', 'sessions']) await env.DB.prepare('DELETE FROM ' + t).run();
  cacheBust('');
  await ensureDefaultRealm(env);

  await registerUser(env, { email: 'own@x.test', character: 'Marcus', businessName: SHOP, asOwner: true, realmId: R });
  await registerUser(env, { email: 'emp@x.test', character: 'Sera', businessName: SHOP, asOwner: false, realmId: R });
  const foreman = await appendUser(env, { uid: 'u-foreman', email: 'mgr@x.test', character: 'Vilkas',
    business: SHOP, role: 'employee', isOwner: false, status: 'active', realmId: R });
  await setManagerRole(env, foreman.uid, true);
  // A SECOND manager, so "a manager may not dismiss a manager" has somebody to
  // be tested against other than themselves.
  const second = await appendUser(env, { uid: 'u-second', email: 'mgr2@x.test', character: 'Farkas',
    business: SHOP, role: 'employee', isOwner: false, status: 'active', realmId: R });
  await setManagerRole(env, second.uid, true);
  // A second shop, so "their own roster only" has something to be tested against.
  await registerUser(env, { email: 'rival@x.test', character: 'Lucan', businessName: RIVAL, asOwner: true, realmId: R });
  await registerUser(env, { email: 'hand@x.test', character: 'Camilla', businessName: RIVAL, asOwner: false, realmId: R });
  // An admin with no shop of their own — somebody has to be able to act when an
  // owner will not.
  await appendUser(env, { uid: 'u-admin', email: 'boss@x.test', character: 'Boss',
    business: '', role: 'admin', isOwner: false, status: 'active', realmId: R });

  const at = async (email) => (await findUserByEmail(env, email)).uid;
  uid = {
    owner: await at('own@x.test'), employee: await at('emp@x.test'), manager: await at('mgr@x.test'),
    manager2: await at('mgr2@x.test'), stranger: await at('hand@x.test'),
  };
  const session = async (email) => (await createSession(env, { email })).token;
  token = {
    owner: await session('own@x.test'), manager: await session('mgr@x.test'),
    employee: await session('emp@x.test'), admin: await session('boss@x.test'),
    rival: await session('rival@x.test'),
  };
});

const roster = async (shop) => (await listUsersByBusiness(env, shop || SHOP, R)).map((u) => u.character).sort();
/** Everyone, in the order `roster()` returns them — what "nothing happened" looks like. */
const ALL = ['Farkas', 'Marcus', 'Sera', 'Vilkas'];
const without = (...names) => ALL.filter((n) => !names.includes(n));

/** A finished, unpaid shift plus a sale carrying commission — money owed. */
async function earnSomething(who) {
  await clockIn(env, { uid: who, employee: 'Sera', business: SHOP, rate: 5 }, R);
  await env.DB.prepare('UPDATE time_card SET clock_in = ? WHERE uid = ? AND clock_out IS NULL')
    .bind(new Date(Date.now() - 4 * 3600000).toISOString(), who).run();
  await clockOut(env, { uid: who, rate: 5 }, R);
  await env.DB.prepare(
    `INSERT INTO sales (realm_id, business, ts, order_no, items, qty_total, total, employee, employee_uid, commission, status)
     VALUES (?, ?, ?, 'S-1', '', 1, 100, 'Sera', ?, 10, '')`)
    .bind(R, SHOP, new Date().toISOString(), who).run();
}

describe('firing somebody', () => {
  it('takes them off the roster', async () => {
    const res = await fire(token.owner, uid.employee);
    expect(res.who).toBe('Sera');
    expect(await roster()).toEqual(without('Sera'));
  });

  it('unregisters them, so a staff code is the way back in', async () => {
    await fire(token.owner, uid.employee);
    expect(await findUserByEmail(env, 'emp@x.test')).toBe(null);
    await registerUser(env, { email: 'emp@x.test', character: 'Sera', businessName: SHOP, asOwner: false, realmId: R });
    expect((await findUserByEmail(env, 'emp@x.test')).business).toBe(SHOP);
  });

  it('can stand a manager down and out in one act', async () => {
    await fire(token.owner, uid.manager);
    expect(await roster()).toEqual(without('Vilkas'));
  });

  it('records who did it, so a roster change is never anonymous', async () => {
    await fire(token.owner, uid.employee);
    const log = await env.DB.prepare("SELECT actor, action, detail FROM audit WHERE action = 'employee.dismissed'").first();
    expect(log.actor).toContain('Marcus');
    expect(log.detail).toContain('Sera');
    expect(log.detail).toContain(SHOP);
  });

  it('refuses a request that did not say so out loud', async () => {
    await expect(fire(token.owner, uid.employee, { confirm: false })).rejects.toThrow(/confirmed/i);
    expect(await roster()).toEqual(ALL);
  });
});

/**
 * The promise the whole thing rests on. Dismissing somebody is not a way to
 * stop owing them: the shifts and the sales carry the BUSINESS on the row, so
 * the debt survives the membership and the owner can still settle it.
 */
describe('what the shop still owes them', () => {
  it('is shown BEFORE the decision, not after', async () => {
    await earnSomething(uid.employee);
    const r = await preview(token.owner, uid.employee);
    expect(r.who).toBe('Sera');
    expect(r.owed.hourly).toBe(20);      // four hours at 5
    expect(r.owed.commission).toBe(10);
    expect(r.owed.total).toBe(30);
    expect(r.canDismiss).toBe(true);
  });

  it('survives the dismissal, still listed by name and still settleable', async () => {
    await earnSomething(uid.employee);
    await fire(token.owner, uid.employee);
    expect(await findUserByEmail(env, 'emp@x.test')).toBe(null); // the membership is gone…

    const log = await shopShifts(env, SHOP, R);
    const hers = log.people.find((p) => p.employee === 'Sera');
    expect(hers).toBeTruthy();                            // …the work is not
    expect(hers.owed).toBe(30);                           // 20 in hours, 10 in commission
    // And the owner can still pay it, which is the half that would be easy to
    // lose: settling reads the uid off the row, not off a live account.
    await markPaid(env, { business: SHOP, uid: uid.employee }, R);
    const after = (await shopShifts(env, SHOP, R)).people.find((p) => p.employee === 'Sera');
    expect(after ? after.owed : 0).toBe(0);
  });

  it('keeps the sales they rang up on the shop’s books', async () => {
    await earnSomething(uid.employee);
    await fire(token.owner, uid.employee);
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM sales WHERE realm_id = ? AND business = ?')
      .bind(R, SHOP).first();
    expect(row.n).toBe(1);
  });
});

describe('who may do it', () => {
  it('the owner may', async () => {
    expect((await fire(token.owner, uid.employee)).ok).toBe(true);
  });

  /**
   * An admin passes the gate — but this route works on the CALLER'S OWN roster,
   * exactly as activate, pay and appoint do, so an admin with no shop of their
   * own reaches nobody through it. That is not an oversight: an admin acting on
   * somebody else's shop does it from the Admin Panel, where the act is a
   * member of the NETWORK being removed and is logged as one. If this route let
   * a shopless admin name any uid, it would be a second, quieter door to the
   * same power with a different audit trail.
   */
  it('an admin passes the gate, but still only reaches their own roster', async () => {
    await expect(fire(token.admin, uid.employee)).rejects.toThrow(/not part of your business/i);
    expect(await roster()).toEqual(ALL);
  });

  it('a manager may let an ordinary employee go', async () => {
    expect((await fire(token.manager, uid.employee)).ok).toBe(true);
    expect(await roster()).toEqual(without('Sera'));
  });

  /**
   * And no further. What stays the OWNER'S is who else has power in the shop —
   * the same line that keeps appointing managers and setting pay out of a
   * manager's hands. A manager who could dismiss managers could clear out
   * everyone the owner might promote instead.
   */
  it('a manager may NOT dismiss another manager, or read the way round it', async () => {
    await expect(fire(token.manager, uid.manager2)).rejects.toThrow(/only the shop’s owner/i);
    const r = await preview(token.manager, uid.manager2);
    expect(r.canDismiss).toBe(false);
    expect(r.refusal).toMatch(/only the shop’s owner/i);
    expect(await roster()).toEqual(ALL);
  });

  /**
   * Themselves included, and it needs no rule of its own — a manager IS a
   * manager, so the sentence above turns them away too. Walking out is still
   * theirs to do from Profile; that is the employee's own decision and always
   * was.
   */
  it('a manager may not dismiss themselves', async () => {
    await expect(fire(token.manager, uid.manager)).rejects.toThrow(/only the shop’s owner/i);
    expect(await roster()).toEqual(ALL);
  });

  it('an employee may dismiss nobody — not a colleague, not a manager', async () => {
    await expect(fire(token.employee, uid.manager)).rejects.toThrow(/owner|manager|admin/i);
    await expect(preview(token.employee, uid.employee)).rejects.toThrow(/owner|manager|admin/i);
    expect(await roster()).toEqual(ALL);
  });

  /**
   * The uid is the only thing the client sends, so one belonging to a stranger
   * would be a way to reach into another shop's roster. The route looks the
   * target up in the CALLER'S OWN roster, so it simply is not there.
   */
  it('reaches nobody on another shop’s roster', async () => {
    await expect(fire(token.owner, uid.stranger)).rejects.toThrow(/not part of your business/i);
    await expect(preview(token.owner, uid.stranger)).rejects.toThrow(/not part of your business/i);
    expect(await roster(RIVAL)).toEqual(['Camilla', 'Lucan']);
  });

  it('and a rival owner cannot reach into this one', async () => {
    await expect(fire(token.rival, uid.employee)).rejects.toThrow(/not part of your business/i);
    expect(await roster()).toEqual(ALL);
  });
});

/**
 * The predicate on its own, as a table of PAIRS. The routes above prove the
 * gate is wired to it; this proves the rule itself, which is the thing that has
 * to stay true when somebody adds a role.
 */
describe('who may dismiss whom', () => {
  const OWNER = { role: 'owner' };
  const ADMIN = { role: 'admin' };
  const BOSS = { role: 'manager' };
  const HAND = { role: 'employee' };
  const may = (caller, target) => dismissalRefusal(caller, target) === '';

  it('an ordinary employee may be let go by anyone who runs the shop', () => {
    expect(may(OWNER, HAND)).toBe(true);
    expect(may(ADMIN, HAND)).toBe(true);
    expect(may(BOSS, HAND)).toBe(true);
  });

  it('a manager is the OWNER’S to dismiss, and no one else’s', () => {
    expect(may(OWNER, BOSS)).toBe(true);
    expect(may(ADMIN, BOSS)).toBe(true);
    expect(may(BOSS, BOSS)).toBe(false);
    expect(dismissalRefusal(BOSS, BOSS)).toMatch(/only the shop’s owner/i);
  });

  /**
   * The same two `leaveRefusal` turns away, for the same reasons — a shop with
   * nobody running it cannot be put right from the inside, and an admin was
   * never on this roster to be taken off it. Nobody may, however senior.
   */
  it('an owner may not be dismissed by anybody at all', async () => {
    expect(may(OWNER, OWNER)).toBe(false);
    expect(may(ADMIN, OWNER)).toBe(false);
    await expect(fire(token.owner, uid.owner)).rejects.toThrow(/owner cannot be dismissed/i);
    expect(await roster()).toEqual(ALL);
  });

  it('names the way out rather than just refusing', () => {
    expect(dismissalRefusal(OWNER, OWNER)).toMatch(/archive the company or hand it to someone else/i);
  });

  it('not an admin — they were never on the roster', () => {
    expect(dismissalRefusal(OWNER, ADMIN)).toMatch(/not on your roster/i);
  });

  it('nobody at all, no', () => {
    expect(dismissalRefusal(OWNER, null)).toBeTruthy();
  });

  /**
   * A caller the function has never heard of gets nothing. It is the safe way
   * round: an unknown role reads as "not the owner", so it can let an ordinary
   * employee go and no more, rather than inheriting the owner's reach.
   */
  it('treats an unknown caller as no better than a manager', () => {
    expect(may({ role: 'porter' }, HAND)).toBe(true);
    expect(may({ role: 'porter' }, BOSS)).toBe(false);
    expect(may(null, BOSS)).toBe(false);
  });

  /**
   * `isOwner` is the flag the row actually carries; the role string is what the
   * screens read. Either one alone must be enough, or a row where they disagree
   * would be a dismissible owner.
   */
  it('is not fooled by a row whose role and owner flag disagree', () => {
    expect(dismissalRefusal(OWNER, { role: 'employee', isOwner: true })).toMatch(/owner cannot be dismissed/i);
  });
});

describe('somebody still clocked in', () => {
  it('is refused, because the open shift would outlive them', async () => {
    await clockIn(env, { uid: uid.employee, employee: 'Sera', business: SHOP, rate: 5 }, R);
    await expect(fire(token.owner, uid.employee)).rejects.toThrow(/clocked in/i);
    expect(await roster()).toEqual(ALL);
  });

  it('says so in the preview, and does not offer the button', async () => {
    await clockIn(env, { uid: uid.employee, employee: 'Sera', business: SHOP, rate: 5 }, R);
    const r = await preview(token.owner, uid.employee);
    expect(r.onShift).toBe(true);
    expect(r.canDismiss).toBe(false);
  });

  it('and may be dismissed the moment the shift is closed', async () => {
    await clockIn(env, { uid: uid.employee, employee: 'Sera', business: SHOP, rate: 5 }, R);
    await clockOut(env, { uid: uid.employee, rate: 5 }, R);
    expect((await preview(token.owner, uid.employee)).canDismiss).toBe(true);
    expect((await fire(token.owner, uid.employee)).ok).toBe(true);
  });
});
