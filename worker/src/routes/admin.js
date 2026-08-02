/**
 * Admin-only routes: network settings, member/company management, the master
 * item + hold indexes, MOTD, market analytics, data backup/restore, log
 * maintenance, and the system-status snapshot.
 */
import { requireAdmin, requireSystemAdmin, requireOwnerOrAdmin, actorName, realmIdOf, isSystemAdmin } from '../guards.js';
import { logAudit, listAudit, listAuditActions } from '../audit.js';
import { readSettings, writeSettings } from '../settings.js';
import { listAllUsers, updateMember, deleteMember, setActiveRealm, transferMember, findUserByUid, isConfiguredAdmin } from '../users.js';
import { listCompanies, updateCompany, archiveCompany, transferCompany, businessJoinCode, regenerateBusinessCode } from '../registry.js';
import { collectExport, restoreImport, previewImport, gzipJson } from '../export.js';
import { marketAnalysis } from '../market.js';
import { clearLogs, purgeLogs, resetAllData } from '../db.js';
import { systemStatus } from '../status.js';
import { readMotd, writeMotd, readWarnDays, writeWarnDays, listIndividualMotds, addIndividualMotd, updateIndividualMotd, deleteIndividualMotd } from '../motd.js';
import { upsertItem as upsertMasterItem, deleteItemIndex, importItemIndex, analyzeItemImport } from '../item-index.js';
import { writeHolds } from '../holds.js';
import { storefrontsEnabled, setStorefrontsEnabled } from '../storefront.js';
import { readBranding, readRealmBranding, writeBranding } from '../branding.js';
import { getFlag, setFlag } from '../db.js';
import { listRealms, createRealm, renameRealm, deleteRealm, realmStats, getRealm, regenerateRealmCode } from '../realm.js';

/**
 * Network Settings belong to a REALM, so these act on whichever realm the
 * caller is currently viewing. A super admin editing realm B's thresholds edits
 * realm B's, not the default realm's.
 */
async function getSettings({ request, env }) {
  const caller = await requireAdmin(request, env);
  return { settings: await readSettings(env, realmIdOf(caller, env)) };
}
async function saveSettings({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  return { settings: await writeSettings(env, body.updates || [], realmIdOf(caller, env)) };
}

/**
 * The member list for the realm being viewed. A super admin may pass ?realm= to
 * read another realm's roster — the Transfers module needs the SOURCE realm's
 * members, which is not necessarily the one being viewed. Ignored for anyone
 * else, so an ordinary admin still cannot look outside their own realm.
 */
async function listMembers({ request, env, url }) {
  const caller = await requireAdmin(request, env);
  const realmId = await sourceRealm(env, caller, isSystemAdmin(env, caller) ? url.searchParams.get('realm') : '');
  const members = await listAllUsers(env, realmId);
  // System Admin is a config grant, not a stored role, so it has to be computed
  // here for the list to be able to show (and protect) it.
  return { members: members.map((m) => ({ ...m, systemAdmin: isConfiguredAdmin(env, m.email) })) };
}
async function updateMemberRoute({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  // A System Admin's role is re-asserted from ADMIN_EMAILS on every sign-in, so
  // letting it be edited here would silently do nothing. Refuse plainly instead.
  const target = await findUserByUid(env, body.uid, realmIdOf(caller, env));
  if (target && isConfiguredAdmin(env, target.email) && String(body.role || '') !== 'admin') {
    throw new Error(target.email + ' is a System Admin (set by the deployment’s ADMIN_EMAILS). ' +
      'Change that setting to alter this account’s role.');
  }
  await updateMember(env, body, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'member.update', detail: 'uid ' + body.uid + ' → ' + body.role + ', ' + (body.business || ''), realmId: realmIdOf(caller, env) });
  return { members: await listAllUsers(env, realmIdOf(caller, env)) };
}
async function deleteMemberRoute({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  await deleteMember(env, body.uid, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'member.delete', detail: 'uid ' + body.uid, realmId: realmIdOf(caller, env) });
  return { members: await listAllUsers(env, realmIdOf(caller, env)) };
}

/** As listMembers: ?realm= is honoured for a super admin only. */
async function listCompaniesRoute({ request, env, url }) {
  const caller = await requireAdmin(request, env);
  const realmId = await sourceRealm(env, caller, isSystemAdmin(env, caller) ? url.searchParams.get('realm') : '');
  return { companies: await listCompanies(env, realmId) };
}
async function updateCompanyRoute({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const companies = await updateCompany(env, body, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'company.update', detail: (body.name || '') + (body.court ? ' [Court]' : ''), realmId: realmIdOf(caller, env) });
  return { companies };
}
async function deleteCompanyRoute({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const companies = await archiveCompany(env, body.id, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'company.archive', detail: 'id ' + body.id, realmId: realmIdOf(caller, env) });
  return { companies };
}

/**
 * A gzipped JSON backup. ?scope=realm limits it to the realm being viewed;
 * anything else takes the whole deployment.
 *
 * A Realm Admin only ever gets their own realm — a whole-deployment file would
 * contain every other realm's rows, which is exactly what their role forbids.
 * Only a System Admin can take the full snapshot.
 */
async function exportData({ request, env, url, cors }) {
  const caller = await requireAdmin(request, env);
  const wantsRealm = url.searchParams.get('scope') === 'realm' || !isSystemAdmin(env, caller);
  const realmId = wantsRealm ? realmIdOf(caller, env) : '';
  const buf = await gzipJson(await collectExport(env, realmId));
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const label = realmId ? 'realm-' + realmId : 'all';
  return new Response(buf, {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/gzip', 'Content-Disposition': 'attachment; filename="vici-backup-' + label + '-' + stamp + '.json.gz"' },
  });
}
/** Dry-run: current-vs-incoming row counts per table, without changing anything. */
async function importPreview({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  return await previewImport(env, body, restoreRealm(env, caller, body));
}
async function importData({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const realmId = restoreRealm(env, caller, body);
  const res = await restoreImport(env, body, realmId);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'data.restore',
    detail: 'restored from backup (' + (realmId ? 'realm ' + realmId : 'whole deployment') + ')', realmId: realmIdOf(caller, env) });
  return res;
}

/**
 * Which realm a restore writes into. A Realm Admin is pinned to their own, so
 * they can never restore a file over another realm — or over the whole
 * deployment. A System Admin may take the file at its word.
 */
function restoreRealm(env, caller, body) {
  if (!isSystemAdmin(env, caller)) return realmIdOf(caller, env);
  if (body && body.scope === 'realm') return realmIdOf(caller, env);
  return '';
}

async function market({ request, env }) {
  const caller = await requireAdmin(request, env);
  return await marketAnalysis(env, realmIdOf(caller, env));
}

async function clearLogsRoute({ request, env }) {
  const caller = await requireAdmin(request, env);
  const res = await clearLogs(env, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'logs.clear', detail: (res.sales || 0) + ' sales, ' + (res.intake || 0) + ' intake', realmId: realmIdOf(caller, env) });
  return res;
}
async function purgeLogsRoute({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const res = await purgeLogs(env, body.amount != null ? body.amount : body.months, body.unit, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'logs.purge', detail: 'older than ' + res.cutoff + ': ' + res.sales + ' sales, ' + res.intake + ' intake', realmId: realmIdOf(caller, env) });
  return res;
}
async function status({ request, env }) {
  const caller = await requireAdmin(request, env);
  return await systemStatus(env, realmIdOf(caller, env));
}

/** Full reset of the CURRENT REALM — keeps admin accounts. Typed confirm. */
async function wipeData({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  if (String(body.confirm || '') !== 'ERASE') throw new Error('Reset not confirmed.');
  const res = await resetAllData(env, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'data.reset', detail: 'full reset — ' + res.tablesCleared + ' tables cleared, ' + res.adminsKept + ' admin(s) kept', realmId: realmIdOf(caller, env) });
  return res;
}

async function motdConfig({ request, env }) {
  const caller = await requireAdmin(request, env);
  const realmId = realmIdOf(caller, env);
  return {
    motd: await readMotd(env, realmId),
    warnDays: await readWarnDays(env, realmId),
    individual: await listIndividualMotds(env, realmId),
  };
}
async function setMotd({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  return { motd: await writeMotd(env, body.motd, realmIdOf(caller, env)) };
}
async function setWarnDays({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  return { warnDays: await writeWarnDays(env, body.days, realmIdOf(caller, env)) };
}
async function addIndividual({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  return { individual: await addIndividualMotd(env, body, realmIdOf(caller, env)) };
}
async function updateIndividual({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  return { individual: await updateIndividualMotd(env, body, realmIdOf(caller, env)) };
}
async function deleteIndividual({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  return { individual: await deleteIndividualMotd(env, body.id, realmIdOf(caller, env)) };
}

async function audit({ request, env, url }) {
  const caller = await requireAdmin(request, env);
  const realmId = realmIdOf(caller, env);
  const q = url.searchParams;
  return {
    audit: await listAudit(env, {
      actor: q.get('actor'), action: q.get('action'),
      from: q.get('from'), to: q.get('to'), realmId,
    }),
    actions: await listAuditActions(env, realmId),
  };
}

async function upsertItemRoute({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const items = await upsertMasterItem(env, body, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'item.upsert', detail: (body.oldName && body.oldName !== body.name ? body.oldName + ' → ' : '') + body.name + ' @ ' + body.baseValue, realmId: realmIdOf(caller, env) });
  return { items };
}
async function deleteMasterItemRoute({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const items = await deleteItemIndex(env, body.name, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'item.delete', detail: body.name, realmId: realmIdOf(caller, env) });
  return { items };
}
async function importMasterItems({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const res = await importItemIndex(env, body.rows, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'item.import', detail: (res.imported || 0) + ' items', realmId: realmIdOf(caller, env) });
  return res;
}
async function analyzeItems({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  return await analyzeItemImport(env, body.rows, realmIdOf(caller, env));
}
/* ---- Sitewide branding (app name, logo, shared iconography) ---- */
/**
 * Branding for editing. A System Admin edits the DEPLOYMENT's identity (what a
 * signed-out visitor sees); a Realm Admin edits their own realm's overrides,
 * which is all their role should reach. `inherited` shows what a blank field
 * will fall back to.
 */
async function getBranding({ request, env }) {
  const caller = await requireAdmin(request, env);
  if (isSystemAdmin(env, caller)) {
    return { scope: 'site', branding: await readBranding(env), inherited: null };
  }
  const realmId = realmIdOf(caller, env);
  return {
    scope: 'realm',
    branding: await readRealmBranding(env, realmId),
    inherited: await readBranding(env),
  };
}
async function saveBranding({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const realmId = isSystemAdmin(env, caller) ? '' : realmIdOf(caller, env);
  const b = await writeBranding(env, body || {}, realmId);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'branding.update', detail: b.appName, realmId: realmIdOf(caller, env) });
  return b;
}

/* ---- Tile images (admin-assigned artwork for the big-button grids) ---- */
const TILE_IMAGES_KEY = 'tile_images';
const HTTPS_URL = /^https:\/\/[^\s"'<>]+$/i;

async function readTileImages(env) {
  const raw = await getFlag(env, TILE_IMAGES_KEY);
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}
async function getTileImages({ request, env }) {
  await requireAdmin(request, env);
  return { images: await readTileImages(env) };
}
async function setTileImages({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const next = {};
  Object.keys(body.images || {}).forEach((k) => {
    const url = String((body.images || {})[k] || '').trim();
    if (!url) return; // blank clears the tile
    // Externally hosted images only, and https so the page stays secure.
    if (!HTTPS_URL.test(url)) throw new Error('Image links must be full https:// URLs (' + k + ').');
    next[String(k).slice(0, 40)] = url.slice(0, 500);
  });
  await setFlag(env, TILE_IMAGES_KEY, JSON.stringify(next));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'tiles.images', detail: Object.keys(next).length + ' image(s) set', realmId: realmIdOf(caller, env) });
  return { images: next };
}

async function getStorefrontFlag({ request, env }) {
  const caller = await requireAdmin(request, env);
  return { enabled: await storefrontsEnabled(env, realmIdOf(caller, env)) };
}
async function setStorefrontFlag({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const on = await setStorefrontsEnabled(env, !!body.enabled, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'storefronts.toggle', detail: on ? 'enabled' : 'disabled', realmId: realmIdOf(caller, env) });
  return { enabled: on };
}
async function setHolds({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const holds = await writeHolds(env, body.holds, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'holds.set', detail: holds.join(', '), realmId: realmIdOf(caller, env) });
  return { holds };
}

/**
 * Realm management. Creating, renaming, or destroying a realm is a super-admin
 * act (an ADMIN_EMAILS address) — a realm's own admin stays inside their realm.
 * Listing and stats are open to any admin, but stats only ever report the
 * caller's OWN realm; no admin can count another realm's rows.
 */
async function realmsList({ request, env }) {
  await requireAdmin(request, env);
  return { realms: await listRealms(env) };
}
async function realmCreate({ request, env, body }) {
  const caller = await requireSystemAdmin(request, env);
  const realm = await createRealm(env, { name: body.name, slug: body.slug });
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'realm.create', detail: realm.name + ' (' + realm.id + ')', realmId: realmIdOf(caller, env) });
  return { realm, realms: await listRealms(env) };
}
async function realmRename({ request, env, body }) {
  const caller = await requireSystemAdmin(request, env);
  const realm = await renameRealm(env, body.id, body.name);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'realm.rename', detail: realm.id + ' -> ' + realm.name, realmId: realmIdOf(caller, env) });
  return { realm, realms: await listRealms(env) };
}
async function realmDelete({ request, env, body }) {
  const caller = await requireSystemAdmin(request, env);
  // Destroys every row in the realm, so require the word to be typed out.
  if (String(body.confirm || '') !== 'DELETE') throw new Error('Type DELETE to confirm removing a realm and everything in it.');
  const result = await deleteRealm(env, body.id);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'realm.delete', detail: result.deleted, realmId: realmIdOf(caller, env) });
  return { ...result, realms: await listRealms(env) };
}
/** Issues a new founder code for a realm, invalidating the old one. */
async function realmCodeReset({ request, env, body }) {
  const caller = await requireSystemAdmin(request, env);
  const code = await regenerateRealmCode(env, body.id);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'realm.code.reset', detail: body.id, realmId: realmIdOf(caller, env) });
  return { joinCode: code, realms: await listRealms(env) };
}

/**
 * A shop's staff code. Its OWN owner can read and reset it — that is the point,
 * they hand it to their employees — and so can an admin of the realm. Anyone
 * else asking gets nothing, since the code is what admits people to the shop.
 */
async function businessCode({ request, env, url }) {
  const caller = await requireOwnerOrAdmin(request, env);
  const business = caller.role === 'admin' && url.searchParams.get('business')
    ? url.searchParams.get('business') : caller.business;
  return { business, joinCode: await businessJoinCode(env, business, realmIdOf(caller, env)) };
}
async function businessCodeReset({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  const business = caller.role === 'admin' && body.business ? body.business : caller.business;
  const code = await regenerateBusinessCode(env, business, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business, action: 'business.code.reset', detail: business, realmId: realmIdOf(caller, env) });
  return { business, joinCode: code };
}

async function realmStatsRoute({ request, env }) {
  const caller = await requireAdmin(request, env);
  return await realmStats(env, realmIdOf(caller, env));
}

/**
 * Switches which realm the caller VIEWS. Super admins only: an ordinary realm
 * admin has no business seeing another server's books, and guards.realmIdOf
 * ignores the stored value for anyone who isn't a super admin anyway — this
 * route is the first of those two locks, not the only one.
 */
async function realmSelect({ request, env, body }) {
  const caller = await requireSystemAdmin(request, env);
  const target = String(body.realmId || '').trim();
  // An empty value means "back to my own realm".
  const chosen = target && target !== caller.realmId ? target : '';
  await setActiveRealm(env, caller.uid, chosen);
  const active = chosen || caller.realmId;
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'realm.select', detail: active, realmId: active });
  return { activeRealm: active, realms: await listRealms(env) };
}

/**
 * Moves a member or a whole company to another realm — the fix when someone
 * picked the wrong server at registration. Super admins only, since it is the
 * one operation that deliberately crosses the boundary.
 */
/**
 * The realm a transfer moves OUT of. Defaults to the one the caller is viewing,
 * which is the common case; a super admin may name a different source so they
 * can fix a misplaced account without switching realms first.
 *
 * This is safe for the same reason realm switching is: only a super admin gets
 * here, and they can already view any realm. It grants no reach they lack — it
 * just saves a round trip. The realm must exist; an unknown id falls back to the
 * active realm rather than silently matching nothing.
 */
async function sourceRealm(env, caller, requested) {
  const want = String(requested || '').trim();
  const active = realmIdOf(caller, env);
  if (!want || want === active) return active;
  return (await getRealm(env, want)) ? want : active;
}

async function realmTransferMember({ request, env, body }) {
  const caller = await requireSystemAdmin(request, env);
  const from = await sourceRealm(env, caller, body.fromRealm);
  const res = await transferMember(env, body.uid, body.toRealm, from);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'realm.member.transfer', detail: body.uid + ': ' + from + ' → ' + body.toRealm, realmId: from });
  return { ...res, members: await listAllUsers(env, from) };
}
async function realmTransferCompany({ request, env, body }) {
  const caller = await requireSystemAdmin(request, env);
  const from = await sourceRealm(env, caller, body.fromRealm);
  const res = await transferCompany(env, body.id, body.toRealm, from);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'realm.company.transfer', detail: (res.moved || body.id) + ': ' + from + ' → ' + body.toRealm, realmId: from });
  return { ...res, companies: await listCompanies(env, from), members: await listAllUsers(env, from) };
}

export const routes = [
  { method: 'GET', path: '/admin/settings', handler: getSettings },
  { method: 'POST', path: '/admin/settings', handler: saveSettings },
  { method: 'GET', path: '/admin/members', handler: listMembers },
  { method: 'POST', path: '/admin/members/update', handler: updateMemberRoute },
  { method: 'POST', path: '/admin/members/delete', handler: deleteMemberRoute },
  { method: 'GET', path: '/admin/companies', handler: listCompaniesRoute },
  { method: 'POST', path: '/admin/companies/update', handler: updateCompanyRoute },
  { method: 'POST', path: '/admin/companies/delete', handler: deleteCompanyRoute },
  { method: 'GET', path: '/admin/export', handler: exportData },
  { method: 'POST', path: '/admin/import/preview', handler: importPreview },
  { method: 'POST', path: '/admin/import', handler: importData },
  { method: 'GET', path: '/admin/market', handler: market },
  { method: 'POST', path: '/admin/logs/clear', handler: clearLogsRoute },
  { method: 'POST', path: '/admin/logs/purge', handler: purgeLogsRoute },
  { method: 'GET', path: '/admin/status', handler: status },
  { method: 'POST', path: '/admin/data/wipe', handler: wipeData },
  { method: 'GET', path: '/admin/motd', handler: motdConfig },
  { method: 'POST', path: '/admin/motd', handler: setMotd },
  { method: 'POST', path: '/admin/motd/warn', handler: setWarnDays },
  { method: 'POST', path: '/admin/motd/individual', handler: addIndividual },
  { method: 'POST', path: '/admin/motd/individual/update', handler: updateIndividual },
  { method: 'POST', path: '/admin/motd/individual/delete', handler: deleteIndividual },
  { method: 'GET', path: '/admin/audit', handler: audit },
  { method: 'POST', path: '/admin/items', handler: upsertItemRoute },
  { method: 'POST', path: '/admin/items/delete', handler: deleteMasterItemRoute },
  { method: 'POST', path: '/admin/items/import', handler: importMasterItems },
  { method: 'POST', path: '/admin/items/import/analyze', handler: analyzeItems },
  { method: 'POST', path: '/admin/holds', handler: setHolds },
  { method: 'GET', path: '/admin/realms', handler: realmsList },
  { method: 'POST', path: '/admin/realms/create', handler: realmCreate },
  { method: 'POST', path: '/admin/realms/rename', handler: realmRename },
  { method: 'POST', path: '/admin/realms/delete', handler: realmDelete },
  { method: 'GET', path: '/admin/realms/stats', handler: realmStatsRoute },
  { method: 'POST', path: '/admin/realms/select', handler: realmSelect },
  { method: 'POST', path: '/admin/realms/code', handler: realmCodeReset },
  { method: 'GET', path: '/business/code', handler: businessCode },
  { method: 'POST', path: '/business/code/reset', handler: businessCodeReset },
  { method: 'POST', path: '/admin/realms/transfer-member', handler: realmTransferMember },
  { method: 'POST', path: '/admin/realms/transfer-company', handler: realmTransferCompany },
  { method: 'GET', path: '/admin/branding', handler: getBranding },
  { method: 'POST', path: '/admin/branding', handler: saveBranding },
  { method: 'GET', path: '/admin/tiles', handler: getTileImages },
  { method: 'POST', path: '/admin/tiles', handler: setTileImages },
  { method: 'GET', path: '/admin/storefronts', handler: getStorefrontFlag },
  { method: 'POST', path: '/admin/storefronts', handler: setStorefrontFlag },
];
