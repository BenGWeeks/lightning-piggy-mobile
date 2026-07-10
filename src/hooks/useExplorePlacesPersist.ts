// Debounced write-through of the Explore in-memory state to AsyncStorage so
// the next cold start has fresh content to hydrate from. Extracted from
// ExploreHomeScreen (the screen just owns the state Maps; persistence is its
// own concern).
//
// `stripHiddenForPersist` drops prod test-account ("Piggy") items before
// saving so prod caches self-heal: stale entries left over from earlier
// versions age out of storage instead of being re-saved forever and crowding
// out real content (MAX_ENTRIES). In dev/preview the full set is persisted.

import { useEffect } from 'react';
import { type ParsedCache, type ParsedEvent } from '../services/nostrPlacesService';
import { saveCaches, saveEvents } from '../services/nostrPlacesStorage';
import { stripHiddenForPersist } from '../utils/exploreContentFilter';

// We don't need to persist on every relay event — a slow debounce is plenty.
const PERSIST_DEBOUNCE_MS = 1500;

/** Write-through `caches` to AsyncStorage, debounced + prod-self-healing. */
export const usePersistCaches = (caches: Map<string, ParsedCache>): void => {
  useEffect(() => {
    if (caches.size === 0) return;
    const items = stripHiddenForPersist([...caches.values()], (c) => c.hiderPubkey);
    const t = setTimeout(() => saveCaches(items), PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [caches]);
};

/** Write-through `events` to AsyncStorage, debounced + prod-self-healing. */
export const usePersistEvents = (events: Map<string, ParsedEvent>): void => {
  useEffect(() => {
    if (events.size === 0) return;
    const items = stripHiddenForPersist([...events.values()], (e) => e.organiserPubkey);
    const t = setTimeout(() => saveEvents(items), PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [events]);
};
