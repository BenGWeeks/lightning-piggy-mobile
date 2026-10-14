import { lockRelays, isTestRelayLockdown, TEST_RELAY_URL } from '../config/testRelayLockdown';
import { getCurrentUserPubkey, onCurrentUserPubkeyChange } from './nostrActiveAccount';

/** Read the account at each operation, never capture it when a pool is created. */
export function activeAccountRelays(urls: string[]): string[] {
  return lockRelays(urls, getCurrentUserPubkey());
}

/** Signed writes belong to their author, even after the active account changes. */
export function eventAuthorRelays(urls: string[], event: { pubkey: string }): string[] {
  return lockRelays(urls, event.pubkey);
}

/** Internal connection context: publish destinations were already resolved by author. */
export interface RelayConnectionParams {
  connectionTimeout?: number;
  abort?: AbortSignal;
  forPublish?: boolean;
}

/** Preserve the SDK request objects and array outside lockdown. */
export function activeAccountRelayRequests<T extends { url: string }>(requests: T[]): T[] {
  if (!isTestRelayLockdown(getCurrentUserPubkey())) return requests;
  return requests.map((request) => ({ ...request, url: TEST_RELAY_URL }));
}

/** Stop existing public subscriptions and reconnect timers on entry to lockdown. */
export function watchTestRelayLockdown(close: () => void): () => void {
  return onCurrentUserPubkeyChange((pubkey) => {
    if (isTestRelayLockdown(pubkey)) close();
  });
}
