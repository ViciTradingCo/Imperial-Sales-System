/**
 * Identity routes: verify a Google sign-in, register against a business, and
 * self-service profile edits.
 */
import { requireUser, requireRegistered, publicUser, bearerToken, findBusinessMeta, markPriority } from '../guards.js';
import { findUserByEmail, setUserCharacter, touchLastSeen } from '../users.js';
import { registerUser } from '../registry.js';

async function handleMe({ request, env }) {
  const payload = await requireUser(request, env);
  const user = await findUserByEmail(env, payload.email);
  if (!user) return { registered: false, email: payload.email, name: payload.name || '' };
  touchLastSeen(env, user.uid); // fire-and-forget
  const meta = await findBusinessMeta(env, user.business);
  markPriority(bearerToken(request), meta.priority); // learn this token's rate tier
  return publicUser(user, { court: meta.court, hold: meta.hold });
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
  });
  return publicUser(user);
}

async function handleUpdateProfile({ request, env, body }) {
  const user = await requireRegistered(request, env);
  const character = String(body.character || '').trim();
  if (!character) throw new Error("Your character name can't be empty.");
  await setUserCharacter(env, user.uid, character);
  user.character = character;
  const meta = await findBusinessMeta(env, user.business);
  return publicUser(user, { court: meta.court, hold: meta.hold });
}

export const routes = [
  { method: 'POST', path: '/auth/me', handler: handleMe },
  { method: 'POST', path: '/auth/register', handler: handleRegister },
  { method: 'POST', path: '/me/profile', handler: handleUpdateProfile },
];
