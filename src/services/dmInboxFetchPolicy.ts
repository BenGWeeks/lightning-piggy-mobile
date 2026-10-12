import { DEFAULT_RELAYS } from './nostrRelayDefaults';

export const DM_INBOX_LIMIT = 1000;
export const KIND4_REPLAY_OVERLAP_SECONDS = 120;

/** Two kind-4 filters, each limited independently on every queried relay. */
export function kind4FetchCapacity(relays: string[] = [], limit = DM_INBOX_LIMIT) {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Invalid DM fetch limit');
  return 2 * limit * new Set([...relays, ...DEFAULT_RELAYS]).size;
}
