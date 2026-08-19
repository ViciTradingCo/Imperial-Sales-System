/**
 * Identity routes: verify a Google sign-in, register against a business, and
 * self-service profile edits.
 *
 * REGISTRATION IS BY CODE. A person signing up is never shown a list of realms
 * or shops — they type a join code and get exactly what it admits them to:
 *
 *   • a realm's FOUNDER code  → Business Creation, where they start a shop
 *   • a shop's STAFF code     → straight into that shop as a pending employee
 *
 * That is the whole point of the design: nobody can see the network, or even
 * learn what else is on it, before they belong to it. There is deliberately no
 * endpoint that lists realms or businesses to an unregistered caller.
 */
import { requireUser, requireRegistered, publicUser, bearerToken, findBusinessMeta, markPriority, realmIdOf, homeRealmOf, isSystemAdmin } from '../guards.js';
import { findUserByEmail, setUserCharacter, touchLastSeen, listMemberships, switchMembership } from '../users.js';
import { createSession, revokeSession, isSessionToken } from '../sessions.js';
import { registerUser, addBusiness } from '../registry.js';
import { listRealms, getRealm, resolveJoinCode } from '../realm.js';
import { readRegions } from '../regions.js';
import { readBranding } from '../branding.js';
import { readRealmPrefs } from '../realm-prefs.js';

async function handleMe({ request, env }) {
  const payload = await requireUser(request, env);
  const user = await findUserByEmail(env, payload.email);
  if (!user) return { registered: false, email: payload.email, name: payload.name || '' };
  touchLastSeen(env, user.uid); // fire-and-forget
  // The caller's OWN shop always lives in their home realm, even while a System
  // Admin is viewing another one — so this deliberately uses homeRealmOf.
  const meta = await findBusinessMeta(env, user.business, homeRealmOf(user));
  markPriority(bearerToken(request), meta.priority); // learn this token's rate tier
  const activeRealm = realmIdOf(user, env);
  const realm = await getRealm(env, activeRealm);
  // How many realms exist at all. Multi-realm is dormant until this is >1: the
  // nav, the Admin Panel, and sign-up all stay silent about realms, so a
  // single-server deployment never has to know the feature is there.
  const realmCount = (await listRealms(env)).length;
  return publicUser(user, {
    court: meta.court,
    hold: meta.hold,
    // systemAdmin gates realm management; the Worker still re-checks it.
    systemAdmin: isSystemAdmin(env, user),
    homeRealm: homeRealmOf(user),
    activeRealm,
    realmName: (realm && realm.name) || activeRealm,
    realmCount,
    // The realm's own branding, layered over the deployment's. Sent here rather
    // than fetched separately so the app can restyle itself the moment it knows
    // who the user is, without a second round trip.
    branding: await readBranding(env, activeRealm),
    // The realm's money name and whether its register asks for a region. Sent
    // with the profile so every screen can render amounts correctly without
    // each one fetching settings of its own.
    prefs: await readRealmPrefs(env, activeRealm),
    /**
     * EVERY SHOP THIS PERSON BELONGS TO. The nav's switcher is built from it,
     * and it is sent with the profile rather than fetched on its own because
     * "which shops are mine" is part of who you are, not a screen's data.
     */
    businesses: (await listMemberships(env, user.email)).map((m) => ({
      uid: m.uid, business: m.business, role: m.role, status: m.status,
      current: m.uid === user.uid,
    })),
  });
}

/**
 * Switches which of your shops you are working as.
 *
 * Everything downstream reads the caller's business from their user row, so
 * this is the whole of it: flip which row is current and the next request is
 * that shop's. The session is untouched — it proves WHO you are, and who you
 * are has not changed.
 */
async function handleSwitchBusiness({ request, env, body }) {
  const payload = await requireUser(request, env);
  const user = await switchMembership(env, payload.email, body.uid);
  if (!user) throw new Error('That is not one of your businesses.');
  return handleMe({ request, env });
}

/**
 * Adds another shop to an already-registered person — by the SAME code that
 * admits a newcomer.
 *
 * A founder code makes a shop and hands them it; a staff code puts them in one
 * as a pending employee. Doing it any other way would mean a second set of
 * rules about who may create a company, and the point of the codes is that
 * there is only one.
 */
async function handleAddBusiness({ request, env, body }) {
  const caller = await requireRegistered(request, env);
  const found = await resolveJoinCode(env, body.code);
  if (!found) throw new Error("That code isn't recognised. Check it with whoever gave it to you.");
  const asOwner = found.kind === 'realm';
  await addBusiness(env, {
    email: caller.email,
    // Their own character name carries across; they are the same person.
    character: caller.character,
    businessName: asOwner ? body.businessName : found.business,
    asOwner,
    hold: asOwner ? body.hold : '',
    realmId: found.realmId,
  });
  return handleMe({ request, env });
}

/**
 * Trades a verified Google sign-in for a session of ours, good for 24 hours.
 *
 * This is the ONLY route that insists on a Google token: accepting a session
 * token here would let a session mint its own successor forever, and the day
 * limit would mean nothing. Signing in again after 24 hours therefore means
 * proving to Google who you are again — which the browser does silently while
 * you are still signed in to Google, so nobody sees a login screen for it.
 *
 * Issued to unregistered callers too. Someone signing up has proved who they
 * are and has several screens still to go; making them do that on an expiring
 * credential is how registration used to fail halfway through.
 */
async function handleSession({ request, env }) {
  if (isSessionToken(bearerToken(request))) {
    throw new Error('Sign in with Google to start a new session.');
  }
  const payload = await requireUser(request, env);
  const user = await findUserByEmail(env, payload.email);
  const { token, expires } = await createSession(env, {
    email: payload.email, name: payload.name || '', uid: user ? user.uid : '',
  });
  return {
    token, expires,
    email: payload.email,
    name: payload.name || '',
    picture: payload.picture || '',
  };
}

/**
 * Ends this session — the "unless they specifically log out" half of staying
 * signed in. The row goes, so the token is dead everywhere at once rather than
 * merely forgotten by the browser that was holding it.
 */
async function handleSignOut({ request, env }) {
  await revokeSession(env, bearerToken(request));
  return { ok: true };
}

/**
 * Checks a join code and reports what it opens, WITHOUT registering anything.
 * The sign-up form calls this to decide which second step to show.
 *
 * A bad code gets one message that never says whether some other code would have
 * worked, so the endpoint can't be used to hunt for valid codes. It is also the
 * only place holds are exposed pre-registration, and only for the realm the code
 * belongs to.
 */
async function handleCheckCode({ request, env, body }) {
  await requireUser(request, env);
  const found = await resolveJoinCode(env, body.code);
  if (!found) throw new Error("That code isn't recognised. Check it with whoever gave it to you.");
  if (found.kind === 'realm') {
    // Business Creation needs the realm's region wording and whether it uses
    // regions at all — the signer-up has no profile to read prefs from yet.
    const prefs = await readRealmPrefs(env, found.realmId);
    return {
      kind: 'realm',
      realmName: found.realmName,
      holds: prefs.showRegion ? await readRegions(env, found.realmId) : [],
      regionLabel: prefs.regionLabel,
      showRegion: prefs.showRegion,
    };
  }
  return { kind: 'business', realmName: found.realmName, business: found.business };
}

/**
 * Registers the signed-in user against the code they were given. The code is
 * re-resolved here rather than trusting anything the check step returned — the
 * realm and business ALWAYS come from the server's own lookup.
 */
async function handleRegister({ request, env, body }) {
  const payload = await requireUser(request, env);
  const existing = await findUserByEmail(env, payload.email);
  if (existing) return publicUser(existing); // idempotent

  const found = await resolveJoinCode(env, body.code);
  if (!found) throw new Error("That code isn't recognised. Check it with whoever gave it to you.");

  const asOwner = found.kind === 'realm';
  const user = await registerUser(env, {
    email: payload.email,
    name: payload.name || '',
    character: body.character,
    // A founder code lets them name their own shop; a staff code puts them in
    // the one the code belongs to, whatever they typed.
    businessName: asOwner ? body.businessName : found.business,
    asOwner,
    hold: asOwner ? body.hold : '',
    realmId: found.realmId,
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
  { method: 'POST', path: '/auth/session', handler: handleSession },
  { method: 'POST', path: '/auth/signout', handler: handleSignOut },
  { method: 'POST', path: '/auth/me', handler: handleMe },
  { method: 'POST', path: '/auth/code', handler: handleCheckCode },
  { method: 'POST', path: '/auth/register', handler: handleRegister },
  { method: 'POST', path: '/auth/business', handler: handleSwitchBusiness },
  { method: 'POST', path: '/auth/business/add', handler: handleAddBusiness },
  { method: 'POST', path: '/me/profile', handler: handleUpdateProfile },
];
