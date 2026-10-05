import { useCallback, useState } from 'react';
import { InteractionManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as nostrService from '../services/nostrService';
import { perAccountKey } from '../services/perAccountStorage';
import type { RelayConfig } from '../types/nostr';
import {
  RELAY_LIST_CACHE_KEY_BASE,
  RELAY_LIST_TIMESTAMP_KEY_BASE,
  CACHE_MAX_AGE_MS,
  readCachedWithTtl,
} from './nostrCacheKeys';

/**
 * The user's published NIP-65 (kind-10002) relay list: hydrate from the
 * per-account cache, refresh from relays, and adopt a list the user just
 * published in-app. Extracted from NostrContext, which composes it.
 */
export function useNip65Relays() {
  const [nip65Relays, setNip65Relays] = useState<RelayConfig[]>([]);

  /** Eagerly hydrate `relays` state from the per-account cache so
   * relay-dependent fan-out (kind-0 publish, NIP-17 send) uses the
   * user's actual relays from the very first action instead of
   * defaulting to `DEFAULT_RELAYS`. Same pattern as
   * `loadProfileFromCache`. */
  const loadRelaysFromCache = useCallback(async (pk: string) => {
    try {
      const raw = await AsyncStorage.getItem(perAccountKey(RELAY_LIST_CACHE_KEY_BASE, pk));
      if (!raw) return false;
      const cached = JSON.parse(raw) as RelayConfig[];
      if (!Array.isArray(cached)) return false;
      // Cached relay-list is the NIP-65 slice; the user overrides are
      // hydrated separately by the `getUserRelays()` effect.
      setNip65Relays(cached);
      return true;
    } catch (error) {
      console.warn('Failed to load relays cache:', error);
      return false;
    }
  }, []);

  const loadRelays = useCallback(async (pk: string): Promise<string[]> => {
    const t0 = Date.now();
    // Cache-fresh fast path — NIP-65 relay lists rarely change, so serve
    // from cache when under the TTL and skip the ~3s relay round trip.
    const { value: cached, ageMs } = await readCachedWithTtl<RelayConfig[]>(
      perAccountKey(RELAY_LIST_CACHE_KEY_BASE, pk),
      perAccountKey(RELAY_LIST_TIMESTAMP_KEY_BASE, pk),
    );
    if (cached && ageMs < CACHE_MAX_AGE_MS) {
      setNip65Relays(cached);
      if (__DEV__) console.log(`[Nostr] fetchRelayList: skipped (cache fresh)`);
      const readRelays = cached.filter((r) => r.read).map((r) => r.url);
      return readRelays.length > 0 ? readRelays : nostrService.DEFAULT_RELAYS;
    }
    const relayList = await nostrService.fetchRelayList(pk, nostrService.DEFAULT_RELAYS);
    if (relayList === null) {
      // Network couldn't produce a kind-10002 — fall back to defaults
      // and DON'T persist (so we don't poison the cache with a blip).
      if (__DEV__) console.log(`[Nostr] fetchRelayList: timed out, using defaults`);
      return nostrService.DEFAULT_RELAYS;
    }
    if (__DEV__)
      console.log(`[Nostr] fetchRelayList: ${Date.now() - t0}ms, ${relayList.length} relays`);
    setNip65Relays(relayList);
    InteractionManager.runAfterInteractions(() => {
      AsyncStorage.setItem(
        perAccountKey(RELAY_LIST_CACHE_KEY_BASE, pk),
        JSON.stringify(relayList),
      ).catch(() => {});
      AsyncStorage.setItem(
        perAccountKey(RELAY_LIST_TIMESTAMP_KEY_BASE, pk),
        Date.now().toString(),
      ).catch(() => {});
    });
    const readRelays = relayList.filter((r) => r.read).map((r) => r.url);
    return readRelays.length > 0 ? readRelays : nostrService.DEFAULT_RELAYS;
  }, []);

  /** Adopt a relay list the user just published (and cache it), so the app
   * uses it straight away instead of waiting for the cache TTL. */
  const applyPublishedRelayList = useCallback(async (pk: string, list: RelayConfig[]) => {
    setNip65Relays(list);
    await AsyncStorage.setItem(perAccountKey(RELAY_LIST_CACHE_KEY_BASE, pk), JSON.stringify(list));
    await AsyncStorage.setItem(
      perAccountKey(RELAY_LIST_TIMESTAMP_KEY_BASE, pk),
      Date.now().toString(),
    );
  }, []);

  return {
    nip65Relays,
    setNip65Relays,
    loadRelaysFromCache,
    loadRelays,
    applyPublishedRelayList,
  };
}
