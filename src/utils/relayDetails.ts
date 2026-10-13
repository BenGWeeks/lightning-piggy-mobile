import type { RelayConfig } from '../types/nostr';
import type { RelayInformation } from '../services/relayInformation';
import type { RelayPublishObservation } from '../services/relayHealth';

export function relayAccessTag(relay: Pick<RelayConfig, 'read' | 'write'>) {
  if (relay.read && relay.write) return null;
  if (relay.read) return 'readOnly';
  if (relay.write) return 'writeOnly';
  return 'disabled';
}

/** Evidence for this key, not a promise that every event will be accepted. */
export function relayWriteAcceptance(
  info: RelayInformation | null,
  last?: RelayPublishObservation,
) {
  if (last) return last.ok ? 'lastAccepted' : 'lastRejected';
  if (!info) return 'unknown';
  const l = info.limitation;
  return l.payment_required ||
    l.auth_required ||
    l.restricted_writes ||
    (l.min_pow_difficulty ?? 0) > 0
    ? 'restricted'
    : 'notTested';
}

export function relayRowHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
