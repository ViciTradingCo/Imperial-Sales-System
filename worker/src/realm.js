/**
 * Realms — multi-tenancy. One deployment can host several independent RP
 * servers; each is a "realm" and NOTHING is shared between them.
 *
 * The isolation rule, in one line: every query against a realm-owned table must
 * filter on realm_id, and the realm ALWAYS comes from the authenticated user's
 * own row — never from a request parameter. A caller cannot name a realm they
 * don't belong to, so there is no way to reach across the boundary.
 *
 * The ONE exception is a super admin (an ADMIN_EMAILS address), who can switch
 * which realm they are viewing from the Admin Panel. Even then the choice is
 * stored on their user row and re-checked on every request (guards.realmIdOf),
 * so it is still read from the database rather than trusted from the client.
 *
 * Use `realmScope(env, realmId)` in data modules: it hands back the db plus the
 * realm id and small SQL helpers, so scoping is one consistent idiom rather
 * than an easily-forgotten `AND realm_id = ?`.
 */
import { getDb, DEFAULT_REALM_ID, REALM_TABLES } from './db.js';

export { DEFAULT_REALM_ID, REALM_TABLES };

function genRealmId() {
  return 'rlm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

/** Normalizes a realm id, falling back to the default realm. */
export function realmOf(value) {
  const r = String(value || '').trim();
  return r || DEFAULT_REALM_ID;
}

/**
 * A realm-bound handle for data modules:
 *   const { db, realmId, and, where } = await realmScope(env, caller.realmId);
 *   db.prepare('SELECT * FROM sales' + where() + ' AND business = ?').bind(realmId, business)
 * `where()` opens the clause with the realm filter (so realmId binds FIRST);
 * `and()` appends it to an existing WHERE.
 */
export async function realmScope(env, realmId) {
  const db = await getDb(env);
  const id = realmOf(realmId);
  return {
    db,
    realmId: id,
    where: () => ' WHERE realm_id = ?',
    and: () => ' AND realm_id = ?',
  };
}

/** Ensures the default realm row exists (so the realm list is never empty). */
export async function ensureDefaultRealm(env) {
  const db = await getDb(env);
  const row = await db.prepare('SELECT id FROM realms WHERE id = ?').bind(DEFAULT_REALM_ID).first();
  if (row) return;
  await db.prepare('INSERT INTO realms (id, name, slug, created) VALUES (?, ?, ?, ?)')
    .bind(DEFAULT_REALM_ID, 'Main Realm', 'main', new Date().toISOString()).run();
}

/**
 * Every realm, each with the two counts the management screen actually shows
 * (shops and members). Two small aggregate queries rather than one per realm,
 * so the list stays a fixed cost however many realms exist.
 */
export async function listRealms(env) {
  await ensureDefaultRealm(env);
  const db = await getDb(env);
  const { results } = await db.prepare('SELECT id, name, slug, created FROM realms ORDER BY created').all();
  const tally = async (table, where) => {
    const { results: rows } = await db.prepare(
      'SELECT realm_id, COUNT(*) AS n FROM ' + table + (where ? ' WHERE ' + where : '') + ' GROUP BY realm_id').all();
    return new Map((rows || []).map((r) => [r.realm_id, r.n]));
  };
  const shops = await tally('companies', "upper(status) != 'ARCHIVED'");
  const members = await tally('users');
  return (results || []).map((r) => ({
    ...r,
    companies: shops.get(r.id) || 0,
    members: members.get(r.id) || 0,
  }));
}

export async function getRealm(env, id) {
  const db = await getDb(env);
  return await db.prepare('SELECT id, name, slug, created FROM realms WHERE id = ?').bind(realmOf(id)).first();
}

export async function createRealm(env, { name, slug }) {
  const nm = String(name || '').trim();
  if (!nm) throw new Error('Enter a realm name.');
  const db = await getDb(env);
  const sl = String(slug || nm).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const clash = await db.prepare('SELECT id FROM realms WHERE lower(name) = ? OR (slug != \'\' AND slug = ?)')
    .bind(nm.toLowerCase(), sl).first();
  if (clash) throw new Error('A realm with that name or slug already exists.');
  const id = genRealmId();
  await db.prepare('INSERT INTO realms (id, name, slug, created) VALUES (?, ?, ?, ?)')
    .bind(id, nm, sl, new Date().toISOString()).run();
  return { id, name: nm, slug: sl };
}

export async function renameRealm(env, id, name) {
  const nm = String(name || '').trim();
  if (!nm) throw new Error('Enter a realm name.');
  const db = await getDb(env);
  const target = realmOf(id);
  const existing = await db.prepare('SELECT id FROM realms WHERE id = ?').bind(target).first();
  if (!existing) throw new Error('Realm not found.');
  await db.prepare('UPDATE realms SET name = ? WHERE id = ?').bind(nm, target).run();
  return { id: target, name: nm };
}

/**
 * Deletes a realm AND everything inside it. Irreversible; the default realm is
 * protected because it holds the original data.
 */
export async function deleteRealm(env, id) {
  const target = realmOf(id);
  if (target === DEFAULT_REALM_ID) throw new Error('The default realm cannot be deleted.');
  const db = await getDb(env);
  const existing = await db.prepare('SELECT id FROM realms WHERE id = ?').bind(target).first();
  if (!existing) throw new Error('Realm not found.');
  const stmts = REALM_TABLES.map((t) => db.prepare('DELETE FROM ' + t + ' WHERE realm_id = ?').bind(target));
  stmts.push(db.prepare('DELETE FROM realms WHERE id = ?').bind(target));
  await db.batch(stmts);
  return { deleted: target, tablesCleared: REALM_TABLES.length };
}

/** Row counts per table for one realm — proves what a realm actually holds. */
export async function realmStats(env, id) {
  const db = await getDb(env);
  const target = realmOf(id);
  const realm = await getRealm(env, target);
  const counts = {};
  for (const t of REALM_TABLES) {
    const r = await db.prepare('SELECT COUNT(*) AS n FROM ' + t + ' WHERE realm_id = ?').bind(target).first();
    counts[t] = r ? r.n : 0;
  }
  return { realmId: target, name: (realm && realm.name) || target, counts };
}
