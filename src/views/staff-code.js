/**
 * The staff code panel, defined ONCE and shown in two places.
 *
 * It lived only under Shop Settings → Staff code, which is where a *setting*
 * belongs but not where anyone looks for it. Someone wanting to bring on an
 * employee goes to EMPLOYEES, finds a roster and no way to invite anybody, and
 * reasonably concludes there is no such button. That is the whole reported
 * problem: the code was not missing, it was filed under the wrong verb.
 *
 * So it appears on both — in Settings, because reissuing one is configuration,
 * and on Employees, because that is the screen you are on when you need it.
 * One definition rather than two copies: the wording and the reissue warning
 * are the same in both places, and cannot drift.
 */
import { api } from '../lib/api.js';
import { codePanel } from './realms.js';

export function staffCodePanel() {
  return codePanel({
    title: '🎟️ Staff code',
    note: 'Give this to anyone who works for you. They enter it when they sign up and land straight in ' +
      'this shop as a pending employee — you activate them below. They never see any other shop.',
    load: async () => (await api.getBusinessCode()).joinCode,
    reset: async () => (await api.resetBusinessCode()).joinCode,
    resetWarning: 'Issue a new staff code?\n\nThe current code stops working immediately — use this if it ' +
      'has been shared somewhere it shouldn’t have been. Anyone still waiting to register will need the new one.',
  });
}
