/**
 * EEC Automated Ledger — Core one-time setup.
 *
 * Prepares the Core so the Worker's scheduled backup and company editing work
 * cleanly:
 *
 *   1. Widens "Certified Users" to include the Hold (K) and Court (L) columns
 *      and writes their headers. (This fixes the "exceeds grid limits" error
 *      when editing a company.)
 *   2. Creates the backup tabs the Worker writes to — Backup_Sales,
 *      Backup_Intake, Backup_Inventory, Backup_Meta — each with its header row.
 *
 * HOW TO RUN — either way works:
 *   • Menu: paste this in the Core (Extensions → Apps Script), Save, then
 *     RELOAD the spreadsheet tab. A new "EEC Setup" menu appears at the top →
 *     click "Run Core setup". (Approve the permission prompt the first time.)
 *   • Editor: in the Apps Script editor, pick `setupCore` in the function
 *     dropdown and click Run.
 *
 * Safe to re-run: existing tabs/columns are left in place; only missing pieces
 * are added. It never deletes data.
 */

/** Adds the "EEC Setup" menu when the spreadsheet opens. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('EEC Setup')
    .addItem('Run Core setup', 'setupCore')
    .addToUi();
}

function setupCore() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureCertColumns_(ss);
  ensureBackupTabs_(ss);
  SpreadsheetApp.getUi().alert('EEC Core setup complete.');
}

/** Certified Users: guarantee columns through L with Hold/Court headers. */
function ensureCertColumns_(ss) {
  var sh = ss.getSheetByName('Certified Users');
  if (!sh) {
    // Create it with the full modern header if it doesn't exist yet.
    sh = ss.insertSheet('Certified Users');
    sh.getRange(1, 1, 1, CERT_HEADERS_.length).setValues([CERT_HEADERS_]);
    return;
  }
  if (sh.getMaxColumns() < CERT_HEADERS_.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), CERT_HEADERS_.length - sh.getMaxColumns());
  }
  // Set the Hold (K) and Court (L) headers without disturbing A–J.
  sh.getRange(1, 11).setValue('Hold');
  sh.getRange(1, 12).setValue('Court');
}

/** Create each Backup_* tab (with headers) if it isn't there already. */
function ensureBackupTabs_(ss) {
  var tabs = {
    'Backup_Sales': ['ID', 'Business', 'Timestamp', 'Order #', 'Customer', 'Hold', 'Items', 'Qty', 'Total', 'Employee', 'Discount', 'Status'],
    'Backup_Intake': ['ID', 'Business', 'Timestamp', 'Item', 'Vendor', 'Source Hold', 'Num Items', 'Price Per'],
    'Backup_Inventory': ['ID', 'Business', 'Item', 'Price', 'Stock', 'Low Stock'],
    'Backup_Meta': ['Last Backup (UTC)', 'Sales Rows', 'Intake Rows', 'Inventory Rows']
  };
  Object.keys(tabs).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var headers = tabs[name];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  });
}

var CERT_HEADERS_ = ['User ID', 'Point of Contact', 'Business Name', 'Subscription Valid Until',
  'Perpetual', 'Status', 'Sync Status', 'Last Sync', 'Sync?', 'Last Wipe', 'Hold', 'Court'];
