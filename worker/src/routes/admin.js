/**
 * Admin-only routes: network settings, member/company management, the master
 * item + hold indexes, MOTD, market analytics, data backup/restore, log
 * maintenance, and the system-status snapshot.
 */
import { requireAdmin, requireSuperAdmin, actorName, realmIdOf } from '../guards.js';
import { logAudit, listAudit, listAuditActions } from '../audit.js';
import { readSettings, writeSettings } from '../settings.js';
import { listAllUsers, updateMember, deleteMember } from '../users.js';
import { listCompanies, updateCompany, archiveCompany } from '../registry.js';
import { collectExport, restoreImport, previewImport, gzipJson } from '../export.js';
import { marketAnalysis } from '../market.js';
import { clearLogs, purgeLogs, resetAllData } from '../db.js';
import { systemStatus } from '../status.js';
import { readMotd, writeMotd, readWarnDays, writeWarnDays, listIndividualMotds, addIndividualMotd, updateIndividualMotd, deleteIndividualMotd } from '../motd.js';
import { upsertItem as upsertMasterItem, deleteItemIndex, importItemIndex, analyzeItemImport } from '../item-index.js';
import { writeHolds } from '../holds.js';
import { storefrontsEnabled, setStorefrontsEnabled } from '../storefront.js';
import { readBranding, writeBranding } from '../branding.js';
import { getFlag, setFlag } from '../db.js';
import { listRealms, createRealm, renameRealm, deleteRealm, realmStats } from '../realm.js';

async function getSettings({ request, env }) {
  await requireAdmin(request, env);
  return { settings: await readSettings(env) };
}
async function saveSettings({ request, env, body }) {
  await requireAdmin(request, env);
  return { settings: await writeSettings(env, body.updates || []) };
}

async function listMembers({ request, env }) {
  const caller = await requireAdmin(request, env);
  return { members: await listAllUsers(env, realmIdOf(caller)) };
}
async function updateMemberRoute({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  await updateMember(env, body, realmIdOf(caller));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'member.update', detail: 'uid ' + body.uid + ' → ' + body.role + ', ' + (body.business || '') });
  return { members: await listAllUsers(env, realmIdOf(caller)) };
}
async function deleteMemberRoute({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  await deleteMember(env, body.uid, realmIdOf(caller));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'member.delete', detail: 'uid ' + body.uid });
  return { members: await listAllUsers(env, realmIdOf(caller)) };
}

async function listCompaniesRoute({ request, env }) {
  const caller = await requireAdmin(request, env);
  return { companies: await listCompanies(env, realmIdOf(caller)) };
}
async function updateCompanyRoute({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const companies = await updateCompany(env, body, realmIdOf(caller));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'company.update', detail: (body.name || '') + (body.court ? ' [Court]' : '') });
  return { companies };
}
async function deleteCompanyRoute({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const companies = await archiveCompany(env, body.id, realmIdOf(caller));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'company.archive', detail: 'id ' + body.id });
  return { companies };
}

/** A gzipped JSON export of all D1 data (a downloadable backup). */
async function exportData({ request, env, cors }) {
  await requireAdmin(request, env);
  const buf = await gzipJson(await collectExport(env));
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return new Response(buf, {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/gzip', 'Content-Disposition': 'attachment; filename="eec-backup-' + stamp + '.json.gz"' },
  });
}
/** Dry-run: current-vs-incoming row counts per table, without changing anything. */
async function importPreview({ request, env, body }) {
  await requireAdmin(request, env);
  return await previewImport(env, body);
}
async function importData({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const res = await restoreImport(env, body);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'data.restore', detail: 'restored from backup' });
  return res;
}

async function market({ request, env }) {
  await requireAdmin(request, env);
  return await marketAnalysis(env);
}

async function clearLogsRoute({ request, env }) {
  const caller = await requireAdmin(request, env);
  const res = await clearLogs(env);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'logs.clear', detail: (res.sales || 0) + ' sales, ' + (res.intake || 0) + ' intake' });
  return res;
}
async function purgeLogsRoute({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const res = await purgeLogs(env, body.amount != null ? body.amount : body.months, body.unit);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'logs.purge', detail: 'older than ' + res.cutoff + ': ' + res.sales + ' sales, ' + res.intake + ' intake' });
  return res;
}
async function status({ request, env }) {
  await requireAdmin(request, env);
  return await systemStatus(env);
}

/** Full reset — wipe all data, keep admin accounts. Guarded by a typed confirm. */
async function wipeData({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  if (String(body.confirm || '') !== 'ERASE') throw new Error('Reset not confirmed.');
  const res = await resetAllData(env);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'data.reset', detail: 'full reset — ' + res.tablesCleared + ' tables cleared, ' + res.adminsKept + ' admin(s) kept' });
  return res;
}

async function motdConfig({ request, env }) {
  await requireAdmin(request, env);
  return { motd: await readMotd(env), warnDays: await readWarnDays(env), individual: await listIndividualMotds(env) };
}
async function setMotd({ request, env, body }) {
  await requireAdmin(request, env);
  return { motd: await writeMotd(env, body.motd) };
}
async function setWarnDays({ request, env, body }) {
  await requireAdmin(request, env);
  return { warnDays: await writeWarnDays(env, body.days) };
}
async function addIndividual({ request, env, body }) {
  await requireAdmin(request, env);
  return { individual: await addIndividualMotd(env, body) };
}
async function updateIndividual({ request, env, body }) {
  await requireAdmin(request, env);
  return { individual: await updateIndividualMotd(env, body) };
}
async function deleteIndividual({ request, env, body }) {
  await requireAdmin(request, env);
  return { individual: await deleteIndividualMotd(env, body.id) };
}

async function audit({ request, env, url }) {
  await requireAdmin(request, env);
  const q = url.searchParams;
  return {
    audit: await listAudit(env, {
      actor: q.get('actor'), action: q.get('action'),
      from: q.get('from'), to: q.get('to'),
    }),
    actions: await listAuditActions(env),
  };
}

async function upsertItemRoute({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const items = await upsertMasterItem(env, body);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'item.upsert', detail: (body.oldName && body.oldName !== body.name ? body.oldName + ' → ' : '') + body.name + ' @ ' + body.baseValue });
  return { items };
}
async function deleteMasterItemRoute({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const items = await deleteItemIndex(env, body.name);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'item.delete', detail: body.name });
  return { items };
}
async function importMasterItems({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const res = await importItemIndex(env, body.rows);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'item.import', detail: (res.imported || 0) + ' items' });
  return res;
}
async function analyzeItems({ request, env, body }) {
  await requireAdmin(request, env);
  return await analyzeItemImport(env, body.rows);
}
/* ---- Sitewide branding (app name, logo, shared iconography) ---- */
async function getBranding({ request, env }) {
  await requireAdmin(request, env);
  return await readBranding(env);
}
async function saveBranding({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const b = await writeBranding(env, body || {});
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'branding.update', detail: b.appName });
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
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'tiles.images', detail: Object.keys(next).length + ' image(s) set' });
  return { images: next };
}

async function getStorefrontFlag({ request, env }) {
  await requireAdmin(request, env);
  return { enabled: await storefrontsEnabled(env) };
}
async function setStorefrontFlag({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const on = await setStorefrontsEnabled(env, !!body.enabled);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'storefronts.toggle', detail: on ? 'enabled' : 'disabled' });
  return { enabled: on };
}
async function setHolds({ request, env, body }) {
  const caller = await requireAdmin(request, env);
  const holds = await writeHolds(env, body.holds);
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'holds.set', detail: holds.join(', ') });
  return { holds };
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
  { method: 'GET', path: '/admin/branding', handler: getBranding },
  { method: 'POST', path: '/admin/branding', handler: saveBranding },
  { method: 'GET', path: '/admin/tiles', handler: getTileImages },
  { method: 'POST', path: '/admin/tiles', handler: setTileImages },
  { method: 'GET', path: '/admin/storefronts', handler: getStorefrontFlag },
  { method: 'POST', path: '/admin/storefronts', handler: setStorefrontFlag },
];
