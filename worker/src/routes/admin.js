/**
 * Admin-only routes: network settings, member/company management, the master
 * item + hold indexes, MOTD, market analytics, data backup/restore, log
 * maintenance, and the system-status snapshot.
 */
import { clearLogs, getFlag, purgeLogs, resetAllData, setFlag } from '../db.js';
import { requireAdmin, requireSystemAdmin, requireOwnerOrAdmin, actorName, realmIdOf, isSystemAdmin, findBusinessMeta } from '../guards.js';
import { logAudit, listAudit, listAuditActions } from '../audit.js';
import { readSettings, writeSettings } from '../settings.js';
import { listAllUsers, updateMember, deleteMember, setActiveRealm, transferMember, findUserByUid, isConfiguredAdmin } from '../users.js';
import { listCompanies, updateCompany, archiveCompany, transferCompany, businessJoinCode, regenerateBusinessCode } from '../registry.js';
import { collectExport, restoreImport, previewImport, gzipJson } from '../export.js';
import { marketAnalysis, itemReport } from '../market.js';
import { systemStatus, clearErrors } from '../status.js';
import { shopOverview } from '../oversight.js';
import { listAllFeedback, setFeedbackComplete } from '../feedback.js';
import { readWarnDays, writeWarnDays, listGlobalMotds, addGlobalMotd, updateGlobalMotd, deleteGlobalMotd,
  listIndividualMotds, addIndividualMotd, updateIndividualMotd, deleteIndividualMotd } from '../motd.js';
import { upsertItem as upsertMasterItem, deleteItemIndex, purgeItemIndex, importItemIndex, analyzeItemImport,
  listItemIndex, moveItems, addItemType, updateItemType, deleteItemType,
  listPendingItems, approveItem } from '../item-index.js';
import { writeRegions } from '../regions.js';
import { readBranding, readRealmBranding, writeBranding } from '../branding.js';
import { readRealmPrefs, writeRealmPrefs } from '../realm-prefs.js';
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
  const names = await realmNames(env);
  // System Admin is a config grant, not a stored role, so it has to be computed
  // here for the list to be able to show (and protect) it. realmName spares the
  // UI from showing a raw id like "rlm-m8x2k1-a4f9".
  return {
    members: members.map((m) => ({
      ...m,
      systemAdmin: isConfiguredAdmin(env, m.email),
      realmName: names.get(m.realmId) || m.realmId,
    })),
  };
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

/**
 * One company's ledger, for an admin looking in from the Company List.
 *
 * READ ONLY, deliberately. An owner runs their own shop: the write paths
 * (adjust the coffer, add a discount, set the style) stay bound to the caller's
 * OWN business, so an admin viewing a company can see its books without an
 * accidental click moving someone else's money. Renaming and certification —
 * the things an admin is actually responsible for — already have their own
 * buttons on that screen.
 *
 * Realm-scoped like every other admin read: `realmIdOf` refuses to return any
 * realm but the caller's, so a Realm Admin cannot name a shop in another realm
 * and read its coffers.
 */
async function companyLedger({ request, env, url }) {
  const caller = await requireAdmin(request, env);
  const realmId = realmIdOf(caller, env);
  const business = String(url.searchParams.get('business') || '').trim();
  if (!business) throw new Error('Which company?');
  const meta = await findBusinessMeta(env, business, realmId);
  if (!meta) throw new Error('No company called "' + business + '" in this realm.');
  // The same snapshot a Court reads of a shop in its region — one idea of what
  // a shop's books are, however you arrived at them.
  return await shopOverview(env, business, realmId);
}

/** As listMembers: ?realm= is honoured for a System Admin only. */
async function listCompaniesRoute({ request, env, url }) {
  const caller = await requireAdmin(request, env);
  const realmId = await sourceRealm(env, caller, isSystemAdmin(env, caller) ? url.searchParams.get('realm') : '');
  const companies = await listCompanies(env, realmId);
  const names = await realmNames(env);
  return { companies: companies.map((c) => ({ ...c, realmName: names.get(c.realmId) || c.realmId })) };
}

/** realm id -> display name, for lists that show which realm a row belongs to. */
async function realmNames(env) {
  return new Map((await listRealms(env)).map((r) => [r.id, r.name]));
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
/** One item in full, for the Item Performance search box. */
async function marketItem({ request, env, url }) {
  const caller = await requireAdmin(request, env);
  return await itemReport(env, url.searchParams.get('name'), realmIdOf(caller, env));
}
async function status({ request, env }) {
  const caller = await requireAdmin(request, env);
  return await systemStatus(env, realmIdOf(caller, env));
}
/**
 * Dismisses recent errors. A System Admin clears the whole buffer; a Realm
 * Admin clears only the entries stamped with their own realm — the buffer is
 * deployment-wide, and clearing must not be the way one realm reaches another's
 * data.
 */
async function clearErrorsRoute({ request, env }) {
  const caller = await requireAdmin(request, env);
  const scope = isSystemAdmin(env, caller) ? '' : realmIdOf(caller, env);
  const res = await clearErrors(env, scope);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'status.errors.clear',
    detail: res.cleared + ' error(s) dismissed', realmId: realmIdOf(caller, env) });
  return res;
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
    global: await listGlobalMotds(env, realmId),
    warnDays: await readWarnDays(env, realmId),
    individual: await listIndividualMotds(env, realmId),
  };
}
async function addGlobal({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  return { global: await addGlobalMotd(env, body, realmIdOf(caller, env)) };
}
async function updateGlobal({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  return { global: await updateGlobalMotd(env, body, realmIdOf(caller, env)) };
}
async function deleteGlobal({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  return { global: await deleteGlobalMotd(env, body.id, realmIdOf(caller, env)) };
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
/**
 * The new-item report: everything the register has invented and nobody has
 * confirmed yet, each with what it might be a duplicate of.
 */
async function pendingItemsRoute({ request, env }) {
  const caller = await requireAdmin(request, env);
  return { pending: await listPendingItems(env, realmIdOf(caller, env)) };
}

/** "Yes, this is a real item." Clears the flag and leaves the row alone. */
async function approveItemRoute({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const realmId = realmIdOf(caller, env);
  const name = await approveItem(env, body.name, realmId);
  await logAudit(env, { actor: actorName(caller), business: caller.business,
    action: 'item.approve', detail: name, realmId });
  return { pending: await listPendingItems(env, realmId), items: await listItemIndex(env, realmId) };
}

async function deleteMasterItemRoute({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const items = await deleteItemIndex(env, body.name, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'item.delete', detail: body.name, realmId: realmIdOf(caller, env) });
  return { items };
}
/**
 * Empties this realm's item index, or one table of it (body.category). Typed
 * confirm — there is no undo.
 */
async function purgeMasterItems({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  if (String(body.confirm || '') !== 'PURGE') throw new Error('Type PURGE to confirm emptying the item index.');
  const res = await purgeItemIndex(env, realmIdOf(caller, env), body.category);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'item.purge',
    detail: res.purged + ' items' + (res.category ? ' from ' + res.category : ''), realmId: realmIdOf(caller, env) });
  return res;
}

/** Re-files a selection of items into one table — the bulk way out of Unsorted. */
async function moveItemsRoute({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const realmId = realmIdOf(caller, env);
  const res = await moveItems(env, body.names, body.category, realmId);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'item.move',
    detail: res.moved + ' item(s) → ' + res.category, realmId });
  return res;
}

/* ---- Feedback on the app (System Admin only) ---- */
/**
 * Feedback is about the SOFTWARE, so it goes to whoever runs the deployment
 * rather than to each realm's own admin — hence requireSystemAdmin, and hence
 * the list not being realm-filtered. Rows carry their realm so the page can say
 * where each came from.
 */
async function listFeedbackRoute({ request, env }) {
  await requireSystemAdmin(request, env);
  return await listAllFeedback(env);
}
/** Marks feedback complete (Active → Archive), or reopens it. */
async function completeFeedbackRoute({ request, env, body }) {
  const caller = await requireSystemAdmin(request, env);
  const res = await setFeedbackComplete(env, body.id, body.complete, actorName(caller));
  await logAudit(env, { actor: actorName(caller), business: caller.business,
    action: body.complete === false ? 'feedback.reopen' : 'feedback.complete',
    detail: String(body.id || ''), realmId: realmIdOf(caller, env) });
  return res;
}

/* ---- Item types: the tables the index is divided into (per realm) ---- */
async function addItemTypeRoute({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const types = await addItemType(env, body.name, realmIdOf(caller, env), body.flags);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'item.type.add',
    detail: String(body.name || ''), realmId: realmIdOf(caller, env) });
  return { types };
}
/** Rename a table and/or replace its sorting flags. */
async function updateItemTypeRoute({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const realmId = realmIdOf(caller, env);
  const types = await updateItemType(env, body, realmId);
  const renamed = body.newName !== undefined && body.newName !== body.name;
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'item.type.update',
    detail: String(body.name || '') + (renamed ? ' → ' + String(body.newName || '') : '') +
      (body.flags !== undefined ? ' · flags updated' : ''), realmId });
  // A rename re-files the items under it, so the screen needs both back.
  return { types, items: renamed ? await listItemIndex(env, realmId) : undefined };
}
/** Removing a table re-files its items as Unsorted; nothing is deleted. */
async function deleteItemTypeRoute({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const realmId = realmIdOf(caller, env);
  const res = await deleteItemType(env, body.name, realmId);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'item.type.delete',
    detail: String(body.name || '') + ' (' + res.moved + ' items → Unsorted)', realmId });
  // The re-filed items come back with it: the screen has to redraw both tables.
  return { ...res, items: await listItemIndex(env, realmId) };
}

/**
 * Bulk import. `into` is the table an unflagged row lands in — a table's own
 * Import/Export passes its name; the whole-index one passes nothing, so those
 * rows go to Unsorted.
 */
async function importMasterItems({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const res = await importItemIndex(env, body.rows, realmIdOf(caller, env), body.into);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'item.import',
    detail: (res.imported || 0) + ' items' + (body.into ? ' into ' + body.into : ''), realmId: realmIdOf(caller, env) });
  return res;
}
async function analyzeItems({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  return await analyzeItemImport(env, body.rows, realmIdOf(caller, env), body.into);
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

/* ---- Tile images (admin-assigned artwork for the big-button grids) ----
 * PER REALM: a Realm Admin dressing their own server must not restyle anyone
 * else's. sys_flags has no realm_id column, so the realm is part of the key. */
const TILE_IMAGES_KEY = 'tile_images';
function tileKey(realmId) { return TILE_IMAGES_KEY + ':' + String(realmId || 'default'); }
const HTTPS_URL = /^https:\/\/[^\s"'<>]+$/i;

async function readTileImages(env, realmId) {
  const raw = await getFlag(env, tileKey(realmId));
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}
async function getTileImages({ request, env }) {
  const caller = await requireAdmin(request, env);
  return { images: await readTileImages(env, realmIdOf(caller, env)) };
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
  await setFlag(env, tileKey(realmIdOf(caller, env)), JSON.stringify(next));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'tiles.images', detail: Object.keys(next).length + ' image(s) set', realmId: realmIdOf(caller, env) });
  return { images: next };
}

async function setHolds({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const holds = await writeRegions(env, body.holds, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'regions.set', detail: holds.join(', '), realmId: realmIdOf(caller, env) });
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

/**
 * Realm preferences — the money's name, and whether the register asks for a
 * region. Per realm, like everything else an admin can change.
 */
async function getRealmPrefs({ request, env }) {
  const caller = await requireAdmin(request, env);
  return await readRealmPrefs(env, realmIdOf(caller, env));
}
async function saveRealmPrefs({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const prefs = await writeRealmPrefs(env, body || {}, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'realm.prefs',
    detail: prefs.currency + ', region ' + (prefs.showRegion ? 'on' : 'off'), realmId: realmIdOf(caller, env) });
  return prefs;
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
 * The realm a transfer (or a scoped list) acts on. Defaults to the one the
 * caller is viewing; a System Admin may name a different source so they can fix
 * a misplaced account without switching realms first.
 *
 * Safe for the same reason realm switching is: only a System Admin can name one,
 * and they can already view any realm — it saves a round trip rather than
 * granting reach. An unknown id THROWS. It used to fall back to the active
 * realm, which meant picking a realm that had just been deleted quietly acted
 * on whichever realm you happened to be in — the one silent failure that can
 * move data into the wrong world.
 */
async function sourceRealm(env, caller, requested) {
  const want = String(requested || '').trim();
  const active = realmIdOf(caller, env);
  if (!want || want === active) return active;
  if (!(await getRealm(env, want))) throw new Error('That realm no longer exists — reload and try again.');
  return want;
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
  { method: 'GET', path: '/admin/companies/ledger', handler: companyLedger },
  { method: 'POST', path: '/admin/companies/update', handler: updateCompanyRoute },
  { method: 'POST', path: '/admin/companies/delete', handler: deleteCompanyRoute },
  { method: 'GET', path: '/admin/export', handler: exportData },
  { method: 'POST', path: '/admin/import/preview', handler: importPreview },
  { method: 'POST', path: '/admin/import', handler: importData },
  { method: 'GET', path: '/admin/market', handler: market },
  { method: 'GET', path: '/admin/market/item', handler: marketItem },
  { method: 'POST', path: '/admin/logs/clear', handler: clearLogsRoute },
  { method: 'POST', path: '/admin/logs/purge', handler: purgeLogsRoute },
  { method: 'GET', path: '/admin/status', handler: status },
  { method: 'GET', path: '/admin/feedback', handler: listFeedbackRoute },
  { method: 'POST', path: '/admin/feedback/complete', handler: completeFeedbackRoute },
  { method: 'POST', path: '/admin/status/errors/clear', handler: clearErrorsRoute },
  { method: 'POST', path: '/admin/data/wipe', handler: wipeData },
  { method: 'GET', path: '/admin/motd', handler: motdConfig },
  { method: 'POST', path: '/admin/motd/global', handler: addGlobal },
  { method: 'POST', path: '/admin/motd/global/update', handler: updateGlobal },
  { method: 'POST', path: '/admin/motd/global/delete', handler: deleteGlobal },
  { method: 'POST', path: '/admin/motd/warn', handler: setWarnDays },
  { method: 'POST', path: '/admin/motd/individual', handler: addIndividual },
  { method: 'POST', path: '/admin/motd/individual/update', handler: updateIndividual },
  { method: 'POST', path: '/admin/motd/individual/delete', handler: deleteIndividual },
  { method: 'GET', path: '/admin/audit', handler: audit },
  { method: 'GET', path: '/admin/items/pending', handler: pendingItemsRoute },
  { method: 'POST', path: '/admin/items/approve', handler: approveItemRoute },
  { method: 'POST', path: '/admin/items', handler: upsertItemRoute },
  { method: 'POST', path: '/admin/items/delete', handler: deleteMasterItemRoute },
  { method: 'POST', path: '/admin/items/purge', handler: purgeMasterItems },
  { method: 'POST', path: '/admin/items/move', handler: moveItemsRoute },
  { method: 'POST', path: '/admin/items/import', handler: importMasterItems },
  { method: 'POST', path: '/admin/items/import/analyze', handler: analyzeItems },
  { method: 'POST', path: '/admin/item-types', handler: addItemTypeRoute },
  { method: 'POST', path: '/admin/item-types/update', handler: updateItemTypeRoute },
  { method: 'POST', path: '/admin/item-types/delete', handler: deleteItemTypeRoute },
  { method: 'POST', path: '/admin/regions', handler: setHolds },
  { method: 'GET', path: '/admin/realms', handler: realmsList },
  { method: 'POST', path: '/admin/realms/create', handler: realmCreate },
  { method: 'POST', path: '/admin/realms/rename', handler: realmRename },
  { method: 'POST', path: '/admin/realms/delete', handler: realmDelete },
  { method: 'GET', path: '/admin/realms/stats', handler: realmStatsRoute },
  { method: 'POST', path: '/admin/realms/select', handler: realmSelect },
  { method: 'POST', path: '/admin/realms/code', handler: realmCodeReset },
  { method: 'GET', path: '/admin/realm-prefs', handler: getRealmPrefs },
  { method: 'POST', path: '/admin/realm-prefs', handler: saveRealmPrefs },
  { method: 'GET', path: '/business/code', handler: businessCode },
  { method: 'POST', path: '/business/code/reset', handler: businessCodeReset },
  { method: 'POST', path: '/admin/realms/transfer-member', handler: realmTransferMember },
  { method: 'POST', path: '/admin/realms/transfer-company', handler: realmTransferCompany },
  { method: 'GET', path: '/admin/branding', handler: getBranding },
  { method: 'POST', path: '/admin/branding', handler: saveBranding },
  { method: 'GET', path: '/admin/tiles', handler: getTileImages },
  { method: 'POST', path: '/admin/tiles', handler: setTileImages },
];
