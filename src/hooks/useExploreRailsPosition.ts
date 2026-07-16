import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { peekCachedAnchorSync } from '../services/btcMapService';
import { isSameFix } from '../utils/locationFix';
import type { LiveUserLocation } from './useLiveUserLocation';

/**
 * One-shot position for the Explore hub's content rails.
 *
 * The rails (Places / Geo-caches / Events) deliberately do NOT consume
 * the shared live watch (`useUserLocation()`) — subscribing at the
 * screen root re-committed the whole Explore tree (measured 240–280 ms)
 * on every watch fix. They just need ONE real position to query around;
 * the mini-map tracks live movement through its own subscription.
 *
 * The pre-#1064 implementation was `getLastKnownPositionAsync` followed
 * by a single un-retried `getCurrentPositionAsync`. On Android that
 * one-shot can reject or stall while a watch on the same provider
 * delivers fine — when it did, `pos` kept its seed (the persisted
 * BTC Map cache anchor, which can be wherever the user last panned a
 * map to) for the entire session: the merchants rail showed another
 * country's shops and the nearby-caches geohash subscription filtered
 * tiles around the stale anchor, so the caches rail sat empty.
 *
 * This hook keeps the seed + fast path, but lands the fresh fix through
 * two parallel channels — the one-shot AND a first-fix watch — with
 * newest-wins timestamp ordering (same pattern as
 * `useLiveUserLocation`). The watch is removed as soon as one fix is
 * accepted, so the rails still don't follow live movement.
 */
export interface ExploreRailsPositionResult {
  pos: LiveUserLocation | null;
  locationDenied: boolean;
}

export function useExploreRailsPosition(): ExploreRailsPositionResult {
  // Seed pos from the cached anchor so rails render before GPS resolves.
  // Accuracy is null (suppresses user dot halo) until a real fix lands.
  const [pos, setPos] = useState<LiveUserLocation | null>(() => {
    const anchor = peekCachedAnchorSync();
    return anchor ? { ...anchor, accuracy: null } : null;
  });
  const [locationDenied, setLocationDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let watch: Location.LocationSubscription | null = null;
    // Newest-wins ordering across the three racing channels (last-known /
    // one-shot / watch): drop any fix older than the last applied one.
    let lastTimestamp = 0;
    let lastApplied: LiveUserLocation | null = null;
    const applyIfNewer = (fix: Location.LocationObject) => {
      const ts = typeof fix.timestamp === 'number' ? fix.timestamp : Date.now();
      if (ts <= lastTimestamp) return;
      lastTimestamp = ts;
      const next: LiveUserLocation = {
        lat: fix.coords.latitude,
        lon: fix.coords.longitude,
        accuracy: typeof fix.coords.accuracy === 'number' ? fix.coords.accuracy : null,
      };
      // Value-dedupe: the one-shot and the watch usually deliver the
      // same place — don't re-render the rails for a duplicate.
      if (lastApplied && isSameFix(lastApplied, next)) return;
      lastApplied = next;
      setPos(next);
    };

    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (perm.status !== 'granted') {
        setLocationDenied(true);
        return;
      }
      // Fast path: last-known position unblocks rails while the fresh
      // fix lands (emulator GPS HAL can take several seconds).
      try {
        const last = await Location.getLastKnownPositionAsync({
          maxAge: 10 * 60 * 1000, // ≤ 10 min old is fine for our 5 km tiles
        });
        if (!cancelled && last) applyIfNewer(last);
      } catch {
        // Non-fatal — the fresh-fix channels below still run.
      }
      // Fresh fix, two parallel channels. `resolves to false` = channel
      // failed outright (rejection / arm failure), not "no fix yet".
      const oneShot = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
        .then((fresh) => {
          if (!cancelled) applyIfNewer(fresh);
          return true;
        })
        .catch(() => false);
      let watchLanded = false;
      const watchArmed = (async () => {
        try {
          const sub = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.High },
            (update) => {
              if (cancelled) return;
              applyIfNewer(update);
              watchLanded = true;
              // First accepted fix is all the rails need.
              watch?.remove();
              watch = null;
            },
          );
          // The callback (or unmount) may have fired while the promise
          // resolved — remove inline rather than orphaning the stream.
          if (cancelled || watchLanded) {
            sub.remove();
          } else {
            watch = sub;
          }
          return true;
        } catch {
          return false;
        }
      })();
      const [oneShotOk, watchOk] = await Promise.all([oneShot, watchArmed]);
      // Both fresh-fix channels failed and not even a last-known fix
      // landed: surface the friendlier "grant location" copy instead of
      // an empty shimmer.
      if (!cancelled && !oneShotOk && !watchOk && lastTimestamp === 0) {
        setLocationDenied(true);
      }
    })();

    return () => {
      cancelled = true;
      watch?.remove();
    };
  }, []);

  return { pos, locationDenied };
}
