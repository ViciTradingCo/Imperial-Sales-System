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
 * In practice that means every data module resolves the realm with
 * `guards.realmIdOf(caller)` and carries it into the SQL itself; there is no
 * ambient "current realm" a query can forget to apply.
 */
import { getDb, DEFAULT_REALM_ID, DEFAULT_REALM_NAME, REALM_TABLES } from './db.js';

export { DEFAULT_REALM_ID, DEFAULT_REALM_NAME, REALM_TABLES };

/**
 * Join codes.
 *
 * A code is the ONLY thing a new user gives us, so it has to identify one realm
 * or one shop on its own — hence globally unique, not per realm. Two kinds:
 *
 *   • FOUNDER code (on a realm) — admits someone to that realm and sends them to
 *     Business Creation, where they start a shop of their own.
 *   • STAFF code (on a company) — registers someone straight into that shop as
 *     an employee, in that shop's realm.
 *
 * The point of both is that a person signing up is never shown a list of realms
 * or shops. They see only what their code admits them to, so nobody can browse
 * the network before they belong to it.
 *
 * The alphabet drops I/O/0/1 — these get read aloud and typed from Discord.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateCode(prefix) {
  let body = '';
  for (let i = 0; i < 8; i++) {
    body += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (i === 3) body += '-';
  }
  return prefix + '-' + body;
}

/** Codes are compared case- and whitespace-insensitively. */
export function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Resolves a join code to what it admits the holder to. Returns null when the
 * code matches nothing — callers must NOT say which kind of code was wrong, so
 * a stranger can't probe for valid codes.
 */
export async function resolveJoinCode(env, code) {
  const want = normalizeCode(code);
  if (!want) return null;
  const db = await getDb(env);

  const realm = await db.prepare('SELECT id, name FROM realms WHERE upper(join_code) = ?').bind(want).first();
  if (realm) return { kind: 'realm', realmId: realm.id, realmName: realm.name };

  const co = await db.prepare(
    "SELECT c.id, c.business, c.realm_id, r.name AS realm_name FROM companies c " +
    "LEFT JOIN realms r ON r.id = c.realm_id " +
    "WHERE upper(c.join_code) = ? AND upper(COALESCE(c.status, '')) != 'ARCHIVED'").bind(want).first();
  if (co) {
    return {
      kind: 'business',
      realmId: co.realm_id,
      realmName: co.realm_name || co.realm_id,
      business: co.business,
    };
  }
  return null;
}

/** Issues a fresh founder code for a realm (replacing any previous one). */
export async function regenerateRealmCode(env, id) {
  const db = await getDb(env);
  const target = realmOf(id);
  const existing = await db.prepare('SELECT id FROM realms WHERE id = ?').bind(target).first();
  if (!existing) throw new Error('Realm not found.');
  const code = generateCode('RLM');
  await db.prepare('UPDATE realms SET join_code = ? WHERE id = ?').bind(code, target).run();
  return code;
}

function genRealmId() {
  return 'rlm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

/**
 * Normalizes a realm id, falling back to the default realm.
 *
 * Internal on purpose: a realm id arriving from OUTSIDE this module comes from
 * the caller's own user row via `guards.realmIdOf`, never from a request
 * parameter. The only caller that ever passed one in was the public storefront
 * route (shelved — see archive/storefront/), which had no signed-in user to
 * read it from.
 */
function realmOf(value) {
  const r = String(value || '').trim();
  return r || DEFAULT_REALM_ID;
}

/**
 * Ensures the built-in realm exists and has a founder code (so the realm list is
 * never empty, and there is always a way for the first person to sign up).
 */
export async function ensureDefaultRealm(env) {
  const db = await getDb(env);
  const row = await db.prepare('SELECT id, join_code FROM realms WHERE id = ?').bind(DEFAULT_REALM_ID).first();
  if (!row) {
    await db.prepare('INSERT INTO realms (id, name, slug, created, join_code) VALUES (?, ?, ?, ?, ?)')
      .bind(DEFAULT_REALM_ID, DEFAULT_REALM_NAME, 'test', new Date().toISOString(), generateCode('RLM')).run();
    return;
  }
  // A realm from before join codes existed still needs one.
  if (!row.join_code) {
    await db.prepare('UPDATE realms SET join_code = ? WHERE id = ?')
      .bind(generateCode('RLM'), DEFAULT_REALM_ID).run();
  }
}

/**
 * Every realm, each with the two counts the management screen actually shows
 * (shops and members). Two small aggregate queries rather than one per realm,
 * so the list stays a fixed cost however many realms exist.
 */
export async function listRealms(env) {
  await ensureDefaultRealm(env);
  const db = await getDb(env);
  const { results } = await db.prepare('SELECT id, name, slug, created, join_code FROM realms ORDER BY created').all();
  const tally = async (table, where) => {
    const { results: rows } = await db.prepare(
      'SELECT realm_id, COUNT(*) AS n FROM ' + table + (where ? ' WHERE ' + where : '') + ' GROUP BY realm_id').all();
    return new Map((rows || []).map((r) => [r.realm_id, r.n]));
  };
  const shops = await tally('companies', "upper(status) != 'ARCHIVED'");
  const members = await tally('users');
  return (results || []).map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    created: r.created,
    joinCode: r.join_code || '',
    companies: shops.get(r.id) || 0,
    members: members.get(r.id) || 0,
    // The built-in realm is permanent: it is where all pre-realm data lives and
    // the fallback every unscoped code path resolves to.
    permanent: r.id === DEFAULT_REALM_ID,
  }));
}

export async function getRealm(env, id) {
  const db = await getDb(env);
  return await db.prepare('SELECT id, name, slug, created, join_code FROM realms WHERE id = ?').bind(realmOf(id)).first();
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
  // Every realm gets a founder code at birth — without one nobody could ever
  // register into it, since sign-up shows no realm list.
  const code = generateCode('RLM');
  await db.prepare('INSERT INTO realms (id, name, slug, created, join_code) VALUES (?, ?, ?, ?, ?)')
    .bind(id, nm, sl, new Date().toISOString(), code).run();
  return { id, name: nm, slug: sl, joinCode: code };
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
 * Deletes a realm AND everything inside it. Irreversible.
 *
 * Two guards, because this is the most destructive action in the system and the
 * only one with no undo:
 *   • The built-in realm can never be deleted — it holds all pre-realm data and
 *     is what every unscoped path falls back to.
 *   • A realm still holding shops or members is refused outright. Emptying it
 *     first (move the shops out, or archive them) forces a deliberate second
 *     look at what is about to be destroyed.
 * Callers must additionally be a System Admin; see routes/admin.js.
 */
export async function deleteRealm(env, id) {
  const target = realmOf(id);
  if (target === DEFAULT_REALM_ID) throw new Error('The built-in realm cannot be deleted.');
  const db = await getDb(env);
  const existing = await db.prepare('SELECT id, name FROM realms WHERE id = ?').bind(target).first();
  if (!existing) throw new Error('Realm not found.');

  const count = async (table) => {
    const r = await db.prepare('SELECT COUNT(*) AS n FROM ' + table + ' WHERE realm_id = ?').bind(target).first();
    return (r && r.n) || 0;
  };
  const shops = await count('companies');
  const members = await count('users');
  if (shops || members) {
    throw new Error('"' + existing.name + '" still holds ' + shops + ' shop(s) and ' + members +
      ' member(s). Move or remove them first — a realm with people in it cannot be deleted outright.');
  }
  const stmts = REALM_TABLES.map((t) => db.prepare('DELETE FROM ' + t + ' WHERE realm_id = ?').bind(target));
  // sys_flags has no realm_id column — realm-scoped values put the realm in the
  // KEY instead ('realm_prefs:<id>', 'branding:<id>', 'tile_images:<id>',
  // 'motd_global:<id>', …). Without this they'd outlive the realm forever, and
  // a realm later created with the same id would silently inherit them.
  stmts.push(db.prepare("DELETE FROM sys_flags WHERE k LIKE ?").bind('%:' + target));
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
