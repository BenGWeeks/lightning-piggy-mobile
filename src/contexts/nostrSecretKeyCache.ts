import * as SecureStore from 'expo-secure-store';
import { LRUCache } from '../utils/lru';
import * as nostrService from '../services/nostrService';
import { NSEC_KEY } from './nostrAuthKeys';

/**
 * Module-level LRU cache for NIP-04 plaintext keyed by event id. Keeps
 * the app-session-latest 1000 decrypted messages in RAM so re-opening
 * the same thread (or navigating away and back) doesn't re-decrypt from
 * scratch. Event id → plaintext mapping is immutable once decrypted
 * (the NIP-04 payload never changes for a given id), so no TTL needed.
 *
 * Cribbed from Arcade's arclib/src/private.ts:9 (`LRUCache<string, …>`).
 * Stays in RAM only — no AsyncStorage persistence — to keep the write
 * path free and avoid serialising full-bundle JSON on every decrypt.
 */
export const nip04PlaintextCache = new LRUCache<string, string>({ max: 1000 });

// Per-(viewer,partner) serialization chain for the optimistic local-
// message disk-cache writes. Without this, two rapid sends (e.g.
// double-tap retry, or two sequential tap-share-from-attach) could
// each read-modify-write the conversation blob concurrently — last
// write wins, losing the prior optimistic row. Per Copilot review #509.
export const appendLocalDmChains = new Map<string, Promise<void>>();
export function __clearNip04PlaintextCacheForTests() {
  nip04PlaintextCache.clear();
}

// Module-scope memo for the current user's secret key. Five paths in this
// file need access to the nsec (sign, publishProfile, publishContactList,
// sendDirectMessage, decrypt), and each one was previously hitting
// SecureStore + bech32-decoding afresh. Memoising keyed by pubkey means
// we read disk + decode once per login and invalidate on logout.
let _cachedSecretKey: { pubkey: string; secretKey: Uint8Array } | null = null;
export async function getMemoisedSecretKey(expectedPubkey: string): Promise<Uint8Array | null> {
  if (_cachedSecretKey && _cachedSecretKey.pubkey === expectedPubkey) {
    return _cachedSecretKey.secretKey;
  }
  const nsec = await SecureStore.getItemAsync(NSEC_KEY);
  if (!nsec) return null;
  const { pubkey, secretKey } = nostrService.decodeNsec(nsec);
  if (pubkey !== expectedPubkey) return null;
  _cachedSecretKey = { pubkey, secretKey };
  return secretKey;
}
export function clearMemoisedSecretKey(): void {
  _cachedSecretKey = null;
}
