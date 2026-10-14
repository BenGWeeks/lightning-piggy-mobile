// One-line answer for Settings → Messages → "Devices for new chats" (#1552):
// how many of the account's devices currently share an invitation key, as
// last seen by a relay scan. Pure: no relays, no React.
import { groupInvitationDevices, type InvitationDevice } from '../services/marmotInvitationDevices';
import type { InvitationInventory } from '../services/marmotInvitationKeys';

export type InvitationDeviceSummary =
  | { state: 'checking' }
  | { state: 'unavailable' }
  | { state: 'notShared' }
  | { state: 'thisPhoneOnly' }
  | { state: 'devices'; count: number };

/**
 * groupInvitationDevices always lists this phone (as a placeholder with no
 * versions when it hasn't published), so count only devices relays hold a
 * key for.
 */
export function summariseInvitationDevices(devices: InvitationDevice[]): InvitationDeviceSummary {
  const shared = devices.filter((d) => d.versions.length > 0);
  if (shared.length === 0) return { state: 'notShared' };
  if (shared.length === 1 && shared[0].kind === 'thisPhone') return { state: 'thisPhoneOnly' };
  return { state: 'devices', count: shared.length };
}

/** i18n key + options for the row's value. Never "Unknown". */
export function invitationDeviceSummaryLabel(summary: InvitationDeviceSummary): {
  key: string;
  options?: { count: number };
} {
  switch (summary.state) {
    case 'checking':
      return { key: 'invitationKeys.summaryChecking' };
    case 'unavailable':
      return { key: 'invitationKeys.summaryUnavailable' };
    case 'notShared':
      return { key: 'invitationKeys.summaryNotShared' };
    case 'thisPhoneOnly':
      return { key: 'invitationKeys.summaryThisPhoneOnly' };
    case 'devices':
      return { key: 'invitationKeys.summaryDevices', options: { count: summary.count } };
  }
}

/** Rescan after this long; until then the last answer is shown as-is. */
export const SUMMARY_FRESH_MS = 10 * 60 * 1000;

const cache = new Map<string, { summary: InvitationDeviceSummary; at: number }>();
const scans = new Map<string, symbol>();

/** Supersede older scans from either the settings row or the full device screen. */
export function beginInvitationDeviceSummaryScan(owner: string): symbol {
  const scan = Symbol();
  scans.set(owner, scan);
  return scan;
}

/** Only the latest complete scan can refresh the shared answer and its age. */
export function completeInvitationDeviceSummaryScan(
  owner: string,
  scan: symbol,
  inventory: InvitationInventory,
  now = Date.now(),
): InvitationDeviceSummary | undefined {
  if (scans.get(owner) !== scan || inventory.partial) return undefined;
  const summary = summariseInvitationDevices(
    groupInvitationDevices(inventory.keys, inventory.localSlot),
  );
  rememberInvitationDeviceSummary(owner, summary, now);
  return summary;
}

/** Remember the latest scan for an account (the full device list feeds this too). */
export function rememberInvitationDeviceSummary(
  owner: string,
  summary: InvitationDeviceSummary,
  now = Date.now(),
): void {
  if (summary.state === 'checking' || summary.state === 'unavailable') return;
  cache.set(owner, { summary, at: now });
}

export function cachedInvitationDeviceSummary(
  owner: string,
  now = Date.now(),
): { summary: InvitationDeviceSummary; fresh: boolean } | undefined {
  const hit = cache.get(owner);
  return hit && { summary: hit.summary, fresh: now - hit.at < SUMMARY_FRESH_MS };
}

/** Test seam. */
export function clearInvitationDeviceSummaries(): void {
  cache.clear();
  scans.clear();
}
