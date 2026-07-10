/**
 * Tiny pub/sub fired after THIS device publishes any kind-37516 cache event
 * (create / edit / expire) or its NIP-09 deletion — i.e. whenever the
 * viewer's own cache set may have changed.
 *
 * Exists so `useCacheNotifications` can re-arm its cache-activity live sub
 * event-driven instead of polling `fetchCachesByAuthor` against 7 relays
 * every 60 s (#1016) — ~1,440 REQ sweeps a day that returned nothing for
 * most users. Lives in the services layer (not `nostrEventBus`, which is a
 * contexts-side module no service imports) so `nostrPlacesPublisher` can
 * notify without a services→contexts dependency; mirrors the `nostrPool`
 * leaf-module pattern.
 */
type OwnCachesChangedListener = () => void;
const listeners = new Set<OwnCachesChangedListener>();

export function notifyOwnCachesChanged(): void {
  for (const l of listeners) {
    try {
      l();
    } catch (e) {
      if (__DEV__) console.warn('[Nostr] own-caches listener threw:', e);
    }
  }
}

export function subscribeOwnCachesChanged(listener: OwnCachesChangedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
