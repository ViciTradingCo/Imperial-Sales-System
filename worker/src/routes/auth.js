/**
 * Identity routes: verify a Google sign-in, register against a business, and
 * self-service profile edits.
 */
import { requireUser, requireRegistered, publicUser, bearerToken, findBusinessMeta, markPriority, realmIdOf, homeRealmOf, isSuperAdmin } from '../guards.js';
import { findUserByEmail, setUserCharacter, touchLastSeen } from '../users.js';
import { registerUser, listBusinessNames } from '../registry.js';
import { listRealms, realmOf, getRealm } from '../realm.js';

async function handleMe({ request, env }) {
  const payload = await requireUser(request, env);
  const user = await findUserByEmail(env, payload.email);
  if (!user) return { registered: false, email: payload.email, name: payload.name || '' };
  touchLastSeen(env, user.uid); // fire-and-forget
  // The caller's OWN shop always lives in their home realm, even while a super
  // admin is viewing another one — so this deliberately uses homeRealmOf.
  const meta = await findBusinessMeta(env, user.business, homeRealmOf(user));
  markPriority(bearerToken(request), meta.priority); // learn this token's rate tier
  const activeRealm = realmIdOf(user, env);
  const realm = await getRealm(env, activeRealm);
  return publicUser(user, {
    court: meta.court,
    hold: meta.hold,
    // superAdmin gates the realm-management UI; the Worker still re-checks it.
    superAdmin: isSuperAdmin(env, user),
    homeRealm: homeRealmOf(user),
    activeRealm,
    realmName: (realm && realm.name) || activeRealm,
  });
}

/**
 * The realms someone can register into, and the shops inside one of them.
 * Both are open to any VERIFIED Google account, registered or not — a person
 * signing up has no account yet, so there is no realm to derive from. Only the
 * id and display name are exposed, which is exactly what the picker needs and
 * nothing that would reveal another realm's contents.
 */
async function handleRealmChoices({ request, env }) {
  await requireUser(request, env);
  const realms = await listRealms(env);
  return { realms: realms.map((r) => ({ id: r.id, name: r.name })) };
}
async function handleRealmBusinesses({ request, env, url }) {
  await requireUser(request, env);
  return { businesses: await listBusinessNames(env, realmOf(url.searchParams.get('realm'))) };
}

async function handleRegister({ request, env, body }) {
  const payload = await requireUser(request, env);
  const existing = await findUserByEmail(env, payload.email);
  if (existing) return publicUser(existing); // idempotent
  const user = await registerUser(env, {
    email: payload.email,
    name: payload.name || '',
    character: body.character,
    businessName: body.businessName,
    asOwner: !!body.asOwner,
    hold: body.hold,
    // The realm is chosen at sign-up and fixed from then on; an admin moves
    // someone who picked wrong (Realm Management → Transfers).
    realmId: realmOf(body.realmId),
  });
  return publicUser(user);
}

async function handleUpdateProfile({ request, env, body }) {
  const user = await requireRegistered(request, env);
  const character = String(body.character || '').trim();
  if (!character) throw new Error("Your character name can't be empty.");
  await setUserCharacter(env, user.uid, character);
  user.character = character;
  const meta = await findBusinessMeta(env, user.business, homeRealmOf(user));
  return publicUser(user, { court: meta.court, hold: meta.hold });
}

export const routes = [
  { method: 'POST', path: '/auth/me', handler: handleMe },
  { method: 'POST', path: '/auth/register', handler: handleRegister },
  { method: 'GET', path: '/auth/realms', handler: handleRealmChoices },
  { method: 'GET', path: '/auth/businesses', handler: handleRealmBusinesses },
  { method: 'POST', path: '/me/profile', handler: handleUpdateProfile },
];
