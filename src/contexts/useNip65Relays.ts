import { useCallback, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as nostrService from '../services/nostrService';
import { perAccountKey } from '../services/perAccountStorage';
import type { RelayConfig } from '../types/nostr';
import { fetchLatestReplaceable } from '../services/nostrRelayLists';
import { dmInboxRelaysFromTags, RELAY_LIST_INDEXERS } from '../utils/relayListEvents';

import {
  RELAY_LIST_CACHE_KEY_BASE,
  RELAY_LIST_TIMESTAMP_KEY_BASE,
  CACHE_MAX_AGE_MS,
  readCachedWithTtl,
} from './nostrCacheKeys';

/** Per-account cache of the user's own NIP-17 DM inbox relays (kind 10050). */
const DM_INBOX_RELAYS_CACHE_KEY_BASE = 'nostr_dm_inbox_relays_v1';

/**
 * The user's published NIP-65 (kind-10002) relay list: hydrate from the
 * per-account cache, refresh from relays, and adopt a list the user just
 * published in-app. Extracted from NostrContext, which composes it.
 */
export function useNip65Relays() {
  const [nip65Relays, setNip65Relays] = useState<RelayConfig[]>([]);
  // The user's own DM inbox relays: others deliver NIP-17 DMs there, so the
  // app must READ them too (merged into getReadRelays by NostrContext).
  const [dmInboxRelays, setDmInboxRelays] = useState<string[]>([]);

  // Bumped by resetRelayLists (logout / identity switch): a background load
  // started for the previous identity must not restore its relays afterwards.
  const generationRef = useRef(0);
  // Same guard for NIP-65 loads: bumped on reset AND when a just-published
  // list is adopted, so a slower, older load can't overwrite it.
  const nip65GenerationRef = useRef(0);

  const loadDmInboxRelays = useCallback(async (pk: string, nip65WriteRelays: string[] = []) => {
    const generation = generationRef.current;
    const current = () => generation === generationRef.current;
    try {
      const raw = await AsyncStorage.getItem(perAccountKey(DM_INBOX_RELAYS_CACHE_KEY_BASE, pk));
      const cached = raw ? (JSON.parse(raw) as unknown) : null;
      if (current() && Array.isArray(cached))
        setDmInboxRelays(cached.filter((u): u is string => typeof u === 'string'));
    } catch {
      /* corrupt cache — the network read below replaces it */
    }
    // The NEWEST published list across relays, not the first reply.
    // Other clients publish it to the user's NIP-65 write relays — look there too.
    const event = await fetchLatestReplaceable(pk, 10050, [
      ...new Set([...nip65WriteRelays, ...nostrService.DEFAULT_RELAYS, ...RELAY_LIST_INDEXERS]),
    ]);
    if (!event || !current()) return;
    const fresh = dmInboxRelaysFromTags(event.tags);
    setDmInboxRelays(fresh);
    await AsyncStorage.setItem(
      perAccountKey(DM_INBOX_RELAYS_CACHE_KEY_BASE, pk),
      JSON.stringify(fresh),
    ).catch(() => {});
  }, []);

  /** Adopt (and cache) DM inbox relays the user just published in-app. */
  const applyPublishedDmInbox = useCallback(async (pk: string, list: string[]) => {
    // A just-published list is the newest; invalidate any in-flight load that
    // could still land an older copy on top of it.
    generationRef.current += 1;
    setDmInboxRelays(list);
    await AsyncStorage.setItem(
      perAccountKey(DM_INBOX_RELAYS_CACHE_KEY_BASE, pk),
      JSON.stringify(list),
    );
  }, []);

  /** Forget both lists (logout / identity switch). */
  const resetRelayLists = useCallback(() => {
    generationRef.current += 1;
    nip65GenerationRef.current += 1;
    setNip65Relays([]);
    setDmInboxRelays([]);
  }, []);

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

  const loadRelays = useCallback(
    async (pk: string): Promise<string[]> => {
      const t0 = Date.now();
      const generation = nip65GenerationRef.current;
      const current = () => generation === nip65GenerationRef.current;
      const writeRelaysOf = (list: RelayConfig[]) => list.filter((r) => r.write).map((r) => r.url);
      // Cache-fresh fast path — NIP-65 relay lists rarely change, so serve
      // from cache when under the TTL and skip the ~3s relay round trip.
      const { value: cached, ageMs } = await readCachedWithTtl<RelayConfig[]>(
        perAccountKey(RELAY_LIST_CACHE_KEY_BASE, pk),
        perAccountKey(RELAY_LIST_TIMESTAMP_KEY_BASE, pk),
      );
      if (cached && ageMs < CACHE_MAX_AGE_MS) {
        if (current()) setNip65Relays(cached);
        // Background: own DM inbox relays (cache first, then network).
        void loadDmInboxRelays(pk, writeRelaysOf(cached));
        if (__DEV__) console.log(`[Nostr] fetchRelayList: skipped (cache fresh)`);
        const readRelays = cached.filter((r) => r.read).map((r) => r.url);
        return readRelays.length > 0 ? readRelays : nostrService.DEFAULT_RELAYS;
      }
      const relayList = await nostrService.fetchRelayList(pk, nostrService.DEFAULT_RELAYS);
      if (relayList === null) {
        // Network couldn't produce a kind-10002 — fall back to defaults
        // and DON'T persist (so we don't poison the cache with a blip).
        if (__DEV__) console.log(`[Nostr] fetchRelayList: timed out, using defaults`);
        void loadDmInboxRelays(pk, writeRelaysOf(cached ?? []));
        return nostrService.DEFAULT_RELAYS;
      }
      if (__DEV__)
        console.log(`[Nostr] fetchRelayList: ${Date.now() - t0}ms, ${relayList.length} relays`);
      void loadDmInboxRelays(pk, writeRelaysOf(relayList));
      // A list published in-app while this load was in flight wins.
      if (!current()) {
        const read = relayList.filter((r) => r.read).map((r) => r.url);
        return read.length > 0 ? read : nostrService.DEFAULT_RELAYS;
      }
      setNip65Relays(relayList);
      InteractionManager.runAfterInteractions(() => {
        if (!current()) return;
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
    },
    [loadDmInboxRelays],
  );

  /** Adopt a relay list the user just published (and cache it), so the app
   * uses it straight away instead of waiting for the cache TTL. */
  const applyPublishedRelayList = useCallback(async (pk: string, list: RelayConfig[]) => {
    nip65GenerationRef.current += 1;
    setNip65Relays(list);
    await AsyncStorage.setItem(perAccountKey(RELAY_LIST_CACHE_KEY_BASE, pk), JSON.stringify(list));
    await AsyncStorage.setItem(
      perAccountKey(RELAY_LIST_TIMESTAMP_KEY_BASE, pk),
      Date.now().toString(),
    );
  }, []);

  return {
    nip65Relays,
    dmInboxRelays,
    resetRelayLists,
    applyPublishedDmInbox,
    loadRelaysFromCache,
    loadRelays,
    applyPublishedRelayList,
  };
}
