/**
 * SHELVED — the inventory bulk import/export, exactly as it shipped.
 *
 * Lifted out of `src/views/inventory.js` unmodified. Its imports are written
 * for that file and do not resolve from here; see this directory's README.
 */
/** Bulk import/export inventory via a copy-paste text box (focus modal). */
function openImportExportModal(onImported) {
  const exportBox = el('textarea', { rows: '8', readonly: true });
  const importBox = el('textarea', { rows: '8', placeholder: 'Item, price, stock, low\n(one per line — “Item price” also works)' });
  const status = el('p', {});
  const importBtn = el('button.primary', { onclick: doImport }, 'Import');
  function setStatus(m, c) { status.className = c || ''; status.textContent = m; }

  api.getInventory().then((inv) => {
    const rows = (inv.inventory || []).map((it) => [it.item, it.price, it.stock, it.lowStock].join(', '));
    exportBox.value = 'Item, Price, Stock, Low Stock\n' + rows.join('\n');
  }).catch(() => {});

  async function doImport() {
    const rows = parseImport(importBox.value);
    if (!rows.length) { setStatus('Nothing to import.', 'error'); return; }
    importBtn.disabled = true; setStatus('Importing…', '');
    try {
      const res = await api.importInventory(rows);
      setStatus('Imported ' + (res.imported || 0) + ' item(s).', 'ok');
      onImported();
    } catch (e) { setStatus(e.message || String(e), 'error'); }
    finally { importBtn.disabled = false; }
  }

  openModal([
    el('h3', {}, 'Import / Export inventory'),
    el('label', {}, 'Export — copy this'),
    exportBox,
    el('label', {}, 'Import — paste here'),
    el('p', { class: 'note' }, 'One item per line: “Item, price, stock, low”. Stock/low optional; a header line is ignored. Sets prices (and stock if given).'),
    importBox,
    importBtn,
    status,
  ]);
}

/** Parses pasted lines into rows (comma-CSV, or "Name price stock low"). */
function parseImport(text) {
  const out = [];
  String(text || '').split('\n').forEach((line) => {
    line = line.trim();
    if (!line) return;
    let parts;
    if (line.includes(',')) parts = line.split(',').map((s) => s.trim());
    else {
      const toks = line.split(/\s+/);
      const nums = [];
      while (toks.length && /^-?\d+(\.\d+)?$/.test(toks[toks.length - 1])) nums.unshift(toks.pop());
      parts = [toks.join(' '), ...nums];
    }
    const [item, price, stock, lowStock] = parts;
    if (item) out.push({ item, price, stock, lowStock });
  });
  return out;
}


/* ---- the Worker half, lifted from worker/src/inventory.js ---- */

/**
 * Bulk upsert from a pasted/CSV list. Each row: { item, price?, stock?, lowStock? }.
 * Omitted numeric fields keep the item's current value (or 0 for a new item), so
 * you can paste just names+prices without wiping stock. Rows with a non-numeric
 * price (e.g. a header line) are skipped.
 */
export async function importInventory(env, business, rows, realmId) {
  const db = await getDb(env);
  const cur = {};
  (await listInventory(env, business, realmId)).forEach((it) => { cur[it.item.toLowerCase()] = it; });
  const pick = (v, existing, dflt) => {
    if (v === undefined || v === null || String(v).trim() === '') return existing;
    const n = Number(v);
    return isFinite(n) ? n : dflt;
  };
  const stmts = [];
  let imported = 0;
  (rows || []).forEach((r) => {
    const name = String(r.item || '').trim();
    if (!name) return;
    const ex = cur[name.toLowerCase()] || {};
    const price = pick(r.price, ex.price, NaN);
    if (!isFinite(price) || price < 0) return; // skip headers / bad rows
    const stock = Math.floor(pick(r.stock, ex.stock !== undefined ? ex.stock : 0, 0));
    const lowRaw = Math.floor(pick(r.lowStock, ex.lowStock !== undefined ? ex.lowStock : 0, 0));
    const low = isFinite(lowRaw) && lowRaw > 0 ? lowRaw : 0;
    stmts.push(db.prepare(
      `INSERT INTO inventory (realm_id, business, item, price, stock, low_stock) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (realm_id, business, item) DO UPDATE SET price = excluded.price, stock = excluded.stock, low_stock = excluded.low_stock`
    ).bind(realmId, business, name, price, isFinite(stock) ? stock : 0, low));
    imported++;
  });
  if (stmts.length) await db.batch(stmts);
  return { imported, inventory: await listInventory(env, business, realmId) };
}

/* ---- the route handler, lifted from worker/src/routes/business.js ---- */

async function importInventoryRoute({ request, env, body }) {
  const caller = await requireOwnerOrAdmin(request, env);
  const res = await importInventory(env, caller.business, body.rows, realmIdOf(caller, env));
  await logAudit(env, { actor: actorName(caller), business: caller.business, action: 'inventory.import', detail: (res.imported || 0) + ' items', realmId: realmIdOf(caller, env) });
  return res;
}
