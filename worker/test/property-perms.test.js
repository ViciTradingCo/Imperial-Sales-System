/**
 * WHO IN A COURT MAY DO WHAT.
 *
 * A Court is two things at once — a shop, and its region's government — and the
 * Property Index is squarely the second. So the payroll of the shop is not the
 * roster of the government:
 *
 *   • its OWNER lets premises, issues the codes that create shops, and renames
 *     the businesses standing on its land;
 *   • a MANAGER reads the index and the data behind it, and changes nothing;
 *   • an EMPLOYEE of the Court does not reach the page at all;
 *   • nobody outside a Court reaches it, whatever their own role.
 *
 * These go through the ROUTES rather than the module, because the gates are the
 * thing being tested and they live there. What is asserted is the boundary: the
 * two gates must disagree in exactly one direction, and a manager who can read
 * must not be able to write by picking a different endpoint.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeD1 } from './d1shim.js';
import { ensureSchema, DEFAULT_REALM_ID, REALM_TABLES } from '../src/db.js';
import { ensureDefaultRealm } from '../src/realm.js';
import { registerUser, updateCompany, listCompanies, findBusinessByName } from '../src/registry.js';
import { appendUser, setManagerRole, findUserByUid } from '../src/users.js';
import { createSession } from '../src/sessions.js';
import { routes as courtRoutes } from '../src/routes/court.js';
import { saveProperty, listProperties } from '../src/property.js';
import { cacheBust } from '../src/cache.js';

let env;
const R = DEFAULT_REALM_ID;
const HOLD = 'Whiterun';
const SEAT = 'Dragonsreach';
const SHOP = 'Iron Hearth';

const req = (token) => ({ headers: { get: (h) => (h === 'Authorization' ? 'Bearer ' + token : null) } });
const route = (method, path) => courtRoutes.find((r) => r.method === method && r.path === path);
const call = (method, path, token, body) =>
  route(method, path).handler({ request: req(token), env, body: body || {}, url: new URL('https://x/' + path) });

beforeAll(async () => { env = { DB: makeD1(), ADMIN_EMAILS: '' }; await ensureSchema(env); });

let token = {};
beforeEach(async () => {
  for (const t of [...REALM_TABLES, 'realms', 'sessions']) await env.DB.prepare('DELETE FROM ' + t).run();
  cacheBust('');
  await ensureDefaultRealm(env);

  await registerUser(env, { email: 'jarl@x.test', character: 'Jarl', businessName: SEAT,
    asOwner: true, hold: HOLD, realmId: R });
  await registerUser(env, { email: 'smith@x.test', character: 'Smith', businessName: SHOP,
    asOwner: true, hold: HOLD, realmId: R });
  const seat = (await listCompanies(env, R)).find((c) => c.business === SEAT);
  await updateCompany(env, { id: seat.id, name: SEAT, hold: HOLD, court: true, perpetual: true }, R);

  // A manager and an ordinary employee, both at the Court itself.
  const steward = await appendUser(env, { uid: 'u-steward', email: 'steward@x.test', character: 'Steward',
    business: SEAT, role: 'employee', isOwner: false, status: 'active', realmId: R });
  await setManagerRole(env, steward.uid, true);
  await appendUser(env, { uid: 'u-guard', email: 'guard@x.test', character: 'Guard',
    business: SEAT, role: 'employee', isOwner: false, status: 'active', realmId: R });

  const session = async (email) => (await createSession(env, { email })).token;
  token = {
    owner: await session('jarl@x.test'),
    manager: await session('steward@x.test'),
    employee: await session('guard@x.test'),
    outsider: await session('smith@x.test'),
  };
});

const aProperty = () => saveProperty(env, HOLD, { name: 'The Old Mill', rent: 10 }, R);

describe('reading the Property Index', () => {
  it('is open to the Court’s owner and its manager', async () => {
    await aProperty();
    for (const who of ['owner', 'manager']) {
      const d = await call('GET', '/court/properties', token[who]);
      expect(d.properties.map((p) => p.name), who).toEqual(['The Old Mill']);
    }
  });

  /**
   * `canEdit` is sent with the list so the SCREEN never offers a button the
   * Worker will refuse. A manager who is shown "Rename business" and then told
   * no has been lied to by the page, not stopped by the server.
   */
  it('tells the screen which of them may change it', async () => {
    expect((await call('GET', '/court/properties', token.owner)).canEdit).toBe(true);
    expect((await call('GET', '/court/properties', token.manager)).canEdit).toBe(false);
  });

  it('is shut to a Court’s ordinary staff', async () => {
    await expect(call('GET', '/court/properties', token.employee))
      .rejects.toThrow(/owner and managers/i);
  });

  it('is shut to a shop that is not a Court, however senior', async () => {
    await expect(call('GET', '/court/properties', token.outsider))
      .rejects.toThrow(/Court businesses only/i);
  });
});

describe('changing the Property Index', () => {
  const writes = [
    ['POST', '/court/properties', () => ({ name: 'The Forge' })],
    ['POST', '/court/properties/remove', (p) => ({ id: p.id })],
    ['POST', '/court/properties/code', (p) => ({ id: p.id })],
    ['POST', '/court/properties/rename', (p) => ({ id: p.id, business: 'Anything' })],
  ];

  it('refuses every write to a manager, not just the obvious one', async () => {
    const p = await aProperty();
    for (const [method, path, body] of writes) {
      await expect(call(method, path, token.manager, body(p)), path)
        .rejects.toThrow(/only the Court’s owner/i);
    }
  });

  it('refuses every write to a Court’s ordinary staff', async () => {
    const p = await aProperty();
    for (const [method, path, body] of writes) {
      await expect(call(method, path, token.employee, body(p)), path)
        .rejects.toThrow(/owner and managers/i);
    }
  });

  it('lets the Court’s owner let premises and issue their code', async () => {
    const added = await call('POST', '/court/properties', token.owner, { name: 'The Forge', rent: 15 });
    expect(added.property).toMatchObject({ name: 'The Forge', rent: 15 });
    const issued = await call('POST', '/court/properties/code', token.owner, { id: added.property.id });
    expect(issued.code).toMatch(/^PROP-/);
    expect(issued.code).not.toBe(added.property.code);
  });
});

describe('renaming the business on a Court’s land', () => {
  /** The property is what names the shop, so the reach IS the premises. */
  async function occupied() {
    const p = await aProperty();
    await env.DB.prepare('UPDATE property SET business = ? WHERE id = ?').bind(SHOP, p.id).run();
    return p;
  }

  it('renames the occupant, and everything it owns follows', async () => {
    const p = await occupied();
    const res = await call('POST', '/court/properties/rename', token.owner, { id: p.id, business: 'Iron Hall' });
    expect(res.renamed).toBe('Iron Hall');
    expect(await findBusinessByName(env, 'Iron Hall', R)).toBeTruthy();
    expect(await findBusinessByName(env, SHOP, R)).toBe(null);
    // Its people came with it — the rename is the shop's, not the row's.
    expect((await findUserByUid(env, (await env.DB.prepare(
      "SELECT uid FROM users WHERE email = 'smith@x.test'").first()).uid)).business).toBe('Iron Hall');
    expect((await listProperties(env, HOLD, R))[0].business).toBe('Iron Hall');
  });

  it('has nothing to rename on empty premises', async () => {
    const p = await aProperty();
    await expect(call('POST', '/court/properties/rename', token.owner, { id: p.id, business: 'Anything' }))
      .rejects.toThrow(/is empty/i);
  });

  /**
   * THE ADMIN'S CODE IS THE EXCEPTION, and it is structural rather than a
   * check: a shop founded with a realm code stands on no property, so there is
   * no property id that reaches it. A Court cannot name what it did not let.
   */
  it('cannot reach a shop that stands on no property', async () => {
    await aProperty();
    // SHOP was founded with a realm code and was never let premises.
    const all = await listProperties(env, HOLD, R);
    expect(all.every((p) => p.business !== SHOP)).toBe(true);
    await expect(call('POST', '/court/properties/rename', token.owner,
      { id: 'prp-not-mine', business: 'Whatever' })).rejects.toThrow(/not in your region/i);
    expect(await findBusinessByName(env, SHOP, R)).toBeTruthy();
  });

  it('cannot reach a property in another Court’s region', async () => {
    const away = await saveProperty(env, 'The Rift', { name: 'Black-Briar Lodge' }, R);
    await expect(call('POST', '/court/properties', token.owner, { id: away.id, name: 'Mine now' }))
      .rejects.toThrow(/not in your region/i);
  });
});
