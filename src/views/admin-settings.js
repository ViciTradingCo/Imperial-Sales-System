/**
 * Admin-only Network Settings page — the whole-network Master Settings (sync
 * cadence + market anomaly thresholds). The API enforces admin-only access.
 */
import { api } from '../lib/api.js';
import { renderSettingsForm } from './settings-form.js';

export function renderAdminSettings(container) {
  renderSettingsForm(container, {
    title: 'Network Settings',
    subtitle: 'Network-wide settings for the whole East Empire network, saved to the Core ' +
      'and applied on the next sync.',
    load: async () => (await api.getSettings()).settings,
    save: async (updates) => (await api.saveSettings(updates)).settings,
  });
}
