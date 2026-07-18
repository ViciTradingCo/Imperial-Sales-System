/**
 * Ledger provisioning. When a business owner registers, we mint them a real
 * Google Sheets ledger (owned by the service account, so the app reaches it with
 * no human sharing step) and seed the tabs the later phases build on.
 *
 * Headers here are ported verbatim from the original Apps Script system
 * (ledger_Library.gs / store_Library.gs) so the POS and the Core sync will
 * recognize them unchanged.
 */
import { createSpreadsheet, updateRange } from './sheets.js';

export const LEDGER_INVENTORY_HEADERS = ['Item', 'Price', 'Stock', 'Low Stock'];
export const LEDGER_SALES_HEADERS = ['Timestamp', 'Order #', 'Customer', 'Hold', 'Items', 'Qty Total', 'Total ($)', 'Employee', 'Discount', 'Status'];
export const DEFAULT_HOLDS = ['Eastmarch', 'Falkreath', 'Haafingar', 'Hjaalmarch', 'The Pale', 'The Reach', 'The Rift', 'Whiterun', 'Winterhold'];

/**
 * Creates a ledger spreadsheet for a business and seeds:
 *   _config       — the settings/identity tab (business name, POC, id, holds)
 *   log_Inventory — item master (empty, headers only)
 *   log_Sales     — sales log (empty, headers only)
 * Returns the new spreadsheet's ID (this becomes the business's User ID in the
 * Certified Users registry, matching the original convention where the shop's
 * ID *is* its ledger's document ID).
 */
export async function createLedger(env, { businessName, pointOfContact }) {
  const title = businessName + ' — EEC Ledger';
  const id = await createSpreadsheet(env, title, ['_config', 'log_Inventory', 'log_Sales']);

  await updateRange(env, id, 'log_Inventory!A1:D1', [LEDGER_INVENTORY_HEADERS]);
  await updateRange(env, id, 'log_Sales!A1:J1', [LEDGER_SALES_HEADERS]);

  // _config seed — only the identity keys needed now; the full palette + sync
  // keys are added when the ledger/settings view is built (Phase 4).
  const cfg = [
    ['Setting', 'Value', 'Notes'],
    ['user.businessName', businessName, 'Business / shop name shown in the EEC registry'],
    ['user.pointOfContact', pointOfContact || '', 'Point of Contact — who to reach about this shop'],
    ['user.id', id, "BACKEND: this shop's ID — always this ledger's document ID (set automatically; never edit)"],
    ['holds.list', DEFAULT_HOLDS.join(', '), 'REPLICA of the Core index (index_Holds_Master) — edit it THERE; local edits are overwritten on sync'],
    ['employees.list', '', 'Employees shown in the register (comma-separated)'],
    ['discounts.list', '', 'Register discounts as "Name: percent" pairs, comma-separated'],
  ];
  await updateRange(env, id, `_config!A1:C${cfg.length}`, cfg);

  return id;
}
