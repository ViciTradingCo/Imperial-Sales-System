/**
 * Admin-only Network Settings page — the whole-network Master Settings (sync
 * cadence + market anomaly thresholds). The API enforces admin-only access.
 */
import { api } from '../lib/api.js';
import { renderSettingsForm } from './settings-form.js';

export function renderAdminSettings(container) {
  renderSettingsForm(container, {
    title: 'Network Settings',
    subtitle: 'The Master Settings for the whole East Empire network. Saved straight to the Core — ' +
      'every shop and the market analysis pick these up on their next sync.',
    load: async () => (await api.getSettings()).settings,
    save: async (updates) => (await api.saveSettings(updates)).settings,
  });
}
