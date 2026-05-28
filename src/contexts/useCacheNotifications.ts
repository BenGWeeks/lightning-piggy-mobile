/**
 * useCacheNotifications — foreground live subscription that fires an OS
 * notification when a kind-1111 find-log is published against one of the
 * viewer's geo-caches (#740).
 *
 * Mirrors the shape of `useDmInbox`'s live sub (the one that opens the
 * kind-4 + kind-1059 stream and fires `fireMessageNotification` per
 * fresh event), but for the public find-log surface. There is no
 * decryption, no follow gate, and no inbox state to mutate — the hook
 * exists purely to listen and ping.
 *
 * "My cache coordinates" is sourced from a one-shot author-listing query
 * via `fetchCachesByAuthor`, with a session-scoped re-fetch when the
 * viewer's pubkey changes or the read relays change. We deliberately do
 * NOT thread this list through NostrContext state — the screens that
 * already display the user's caches each have their own hydration
 * paths, and bolting another reactive source onto the context would
 * grow that over-cap file without a clear win. The cost is one
 * `fetchCachesByAuthor` per identity-switch; cheap (kind-37516 by one
 * pubkey is replaceable and bounded).
 *
 * Freshness gate matches the DM live sub: only events whose own
 * `created_at` ≥ `subOpenedAtSec − NOTIFY_SKEW_SEC` fire a notification,
 * so the relay's historical replay on cold start stays silent. Per-event
 * dedup via a session Set so the same find-log delivered by multiple
 * relays only fires once.
 */
import { useEffect, useRef } from 'react';
import type { VerifiedEvent } from 'nostr-tools';
import { subscribeCacheCommentsForCoords } from '../services/cacheNotifySubscription';
import { fireCacheNotification } from '../services/notificationService';
import { fetchCachesByAuthor } from '../services/nostrPlacesPublisher';
import { parseCacheCoord } from '../services/nostrPlacesService';

// Tolerate sender/receiver clock drift — matches the DM live sub.
const NOTIFY_SKEW_SEC = 120;

// Bounded session dedup. Find-logs against a popular cache could stream
// in heavy bursts (e.g. a treasure hunt going viral) and we don't want
// the Set to grow unboundedly across the life of the sub.
const SEEN_CAP = 1000;

export interface UseCacheNotificationsParams {
  /** Active viewer's hex pubkey. Null when logged out — sub stays closed. */
  pubkey: string | null;
  /** Stable getter returning the current read relays. Same shape as the
   * one `useDmInbox` consumes, so callers can pass the same value. */
  getReadRelays: () => string[];
}

/**
 * Open the live find-log subscription for the viewer's caches. Returns
 * nothing — the hook fires notifications as a side-effect and tears
 * down the sub on unmount / pubkey change / relay change.
 *
 * Idempotent: rendering the hook with the same params is a no-op
 * between effect runs.
 */
export function useCacheNotifications(params: UseCacheNotificationsParams): void {
  const { pubkey, getReadRelays } = params;

  // Snapshot the current relays once per effect run — passing
  // `getReadRelays` itself into the dep array re-opens the sub on every
  // identity-stable render that recomputed the getter. The actual relays
  // are captured below and re-evaluated when `getReadRelays` reference
  // changes (which is what the DM sub already keys on).
  const lastRelaysRef = useRef<string[] | null>(null);

  useEffect(() => {
    if (!pubkey) return;
    const readRelays = getReadRelays();
    lastRelaysRef.current = readRelays;
    if (readRelays.length === 0) return;

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const seen = new Set<string>();
    const subOpenedAtSec = Math.floor(Date.now() / 1000);

    const handle = (ev: VerifiedEvent): void => {
      if (cancelled) return;
      if (seen.has(ev.id)) return;
      seen.add(ev.id);
      // Bounded dedup — drop oldest ~25% under sustained pressure (same
      // pattern as the DM live sub's `seen` Set).
      if (seen.size > SEEN_CAP) {
        const drop = Math.floor(SEEN_CAP / 4);
        const it = seen.values();
        for (let i = 0; i < drop; i++) seen.delete(it.next().value!);
      }
      // Never self-ping — the hider commenting on their own cache is a
      // maintenance note, not a find we want to surface as a notification.
      if (ev.pubkey === pubkey) return;
      // Freshness gate — silent on backlog the relay replays on sub open.
      if (ev.created_at < subOpenedAtSec - NOTIFY_SKEW_SEC) return;

      // The cache coord rides on the `A` (uppercase) NIP-22 root pointer.
      // `buildComment` in nostrPlacesService writes both `A` and `a`; we
      // read `A` because that's what the filter matched on.
      const coordTag = ev.tags.find((t) => t[0] === 'A')?.[1];
      if (!coordTag) return;
      const parsed = parseCacheCoord(coordTag);
      if (!parsed) return;

      // Generic copy — the lock-screen-content toggle in
      // notificationService substitutes a generic title/body when the
      // user opts out of content on the lock screen. The richer
      // "Find on <cache name> by <finder>" body could be resolved here
      // by reading the cached ParsedCache + a profile lookup, but
      // doing so blocks on cache-store + relay round-trips inside an
      // event handler running on a hot stream. The follow-up is to
      // resolve those off the hot path and pass them in.
      void fireCacheNotification({
        cacheCoord: coordTag,
        title: 'New find on your cache',
        body: 'Open Lightning Piggy to view',
      });
    };

    // Resolve "my caches" with a one-shot author query, then open the
    // sub. fetchCachesByAuthor caps internally at 5 s so a slow relay
    // can't pin the hook on mount.
    (async () => {
      try {
        const myCaches = await fetchCachesByAuthor(pubkey, readRelays);
        if (cancelled) return;
        const coords = myCaches.map((c) => c.coord);
        if (coords.length === 0) return;
        unsubscribe = subscribeCacheCommentsForCoords({
          viewerPubkey: pubkey,
          relays: readRelays,
          cacheCoords: coords,
          onEvent: handle,
        });
      } catch {
        // Non-fatal — the background detect-and-ping pass still catches
        // anything we miss here on the next wake.
      }
    })();

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [pubkey, getReadRelays]);
}
