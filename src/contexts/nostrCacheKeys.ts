import AsyncStorage from '@react-native-async-storage/async-storage';
import { InteractionManager } from 'react-native';

import { perAccountKey } from '../services/perAccountStorage';
import type { NostrProfile } from '../types/nostr';

// Cache key bases — each is suffixed with `_${pubkey}` via perAccountKey()
// at every call site (#288). The legacy un-suffixed keys are migrated on
// first launch by `migrateToPerAccountStorage`.
export const CONTACTS_CACHE_KEY_BASE = 'nostr_contacts_cache';
export const PROFILES_CACHE_KEY_BASE = 'nostr_profiles_cache';
export const CACHE_TIMESTAMP_KEY_BASE = 'nostr_cache_timestamp';
export const CONTACTS_TIMESTAMP_KEY_BASE = 'nostr_contacts_timestamp';
// Exported so AccountDrawerContent + AccountSwitcherSheet can seed
// their per-identity profile caches synchronously from AsyncStorage
// before fanning out to relays — otherwise they always wait on a
// network round-trip per non-active identity, making the switcher
// slow to populate names + avatars.
export const OWN_PROFILE_CACHE_KEY_BASE = 'nostr_own_profile_cache';
export const OWN_PROFILE_TIMESTAMP_KEY_BASE = 'nostr_own_profile_timestamp';
export const RELAY_LIST_CACHE_KEY_BASE = 'nostr_relay_list_cache';
export const RELAY_LIST_TIMESTAMP_KEY_BASE = 'nostr_relay_list_timestamp';
export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours — for all-cached fast path
// A contact whose kind-0 we couldn't resolve on the previous attempt is
// retried much sooner than 24 h. The "miss" often reflects the user's
// profile being on a relay we hadn't hit yet at that moment, not that
// they've never published one — a shorter retry window turns a few of
// those no-profile contacts into resolved ones within the hour.
export const MISSING_PROFILE_RETRY_MS = 60 * 60 * 1000; // 1 hour

/**
 * Read a JSON-serialised cache value and its timestamp in a single
 * `multiGet` call. Returns the parsed value (or null if missing / corrupt)
 * and the cache age in ms (Infinity when no timestamp exists yet).
 */
export async function readCachedWithTtl<T>(
  dataKey: string,
  tsKey: string,
): Promise<{ value: T | null; ageMs: number }> {
  try {
    const pairs = await AsyncStorage.multiGet([dataKey, tsKey]);
    let dataStr: string | null = null;
    let tsStr: string | null = null;
    for (const [k, v] of pairs) {
      if (k === dataKey) dataStr = v;
      else if (k === tsKey) tsStr = v;
    }
    const value = dataStr ? (JSON.parse(dataStr) as T) : null;
    const ageMs = tsStr ? Date.now() - parseInt(tsStr, 10) : Infinity;
    return { value, ageMs };
  } catch {
    return { value: null, ageMs: Infinity };
  }
}

/**
 * Merge freshly-fetched profiles on top of the existing on-disk profile
 * cache (so contacts we didn't refetch keep their known profile) and bump
 * the cache timestamp. Deferred behind InteractionManager so the writes
 * don't compete with an in-progress render/gesture.
 */
export function persistMergedProfileCache(
  pk: string,
  existing: Record<string, NostrProfile>,
  fetched: Map<string, NostrProfile>,
): void {
  InteractionManager.runAfterInteractions(() => {
    const merged: Record<string, NostrProfile> = { ...existing };
    fetched.forEach((v, k) => {
      merged[k] = v;
    });
    AsyncStorage.setItem(perAccountKey(PROFILES_CACHE_KEY_BASE, pk), JSON.stringify(merged)).catch(
      () => {},
    );
    AsyncStorage.setItem(perAccountKey(CACHE_TIMESTAMP_KEY_BASE, pk), Date.now().toString()).catch(
      () => {},
    );
  });
}
