/**
 * Owner Ledger Settings page — per-shop tunables (currently the pricing-flag
 * threshold for this shop's inventory). Scoped to the caller's business by the
 * API. More ledger management (inventory, discounts, employees, style) arrives
 * in a later phase.
 */
import { api } from '../lib/api.js';
import { renderSettingsForm } from './settings-form.js';

export function renderLedgerSettings(container, { me }) {
  renderSettingsForm(container, {
    title: 'Ledger Settings — ' + (me.business || 'your shop'),
    subtitle: 'Settings for your shop. These apply only to your business. ' +
      'Full ledger management (inventory, discounts, employees, style) arrives in a later phase.',
    load: async () => (await api.getLedgerSettings()).settings,
    save: async (updates) => (await api.saveLedgerSettings(updates)).settings,
  });
}
