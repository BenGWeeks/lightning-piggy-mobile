import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { getDevPinnedLocation } from '../utils/devLocation';

/**
 * Live user-location subscription for map views.
 *
 * Every map surface in the app (Explore hub, MapScreen, PlacesScreen,
 * EventsScreen, HuntScreen, PlaceDetailScreen, LocationPickerSheet)
 * had its own one-shot `getCurrentPositionAsync` at mount, so the
 * user dot froze at wherever they were when the screen opened —
 * walking around with a map open did not move the dot.
 *
 * This hook replaces that pattern with the same three-step ladder
 * but adds a `watchPositionAsync` subscription that keeps the
 * returned `pos` fresh as the user moves:
 *   1. Dev-pinned location (emulator parity, `__DEV__` only) →
 *      surfaced immediately, no GPS hardware touched, no watch
 *      subscription (the pin is a literal value).
 *   2. `getLastKnownPositionAsync` → near-instant cached fix so the
 *      map paints content while a fresh fix lands in parallel.
 *   3. `getCurrentPositionAsync` → fresh fix to overwrite the stale
 *      last-known (often a few streets away in the same town —
 *      that's what #595 was about).
 *   4. `watchPositionAsync` → ongoing updates every ~5s / 10m so the
 *      user dot follows them as they walk around.
 *
 * `denied` flips when the user has rejected the foreground-location
 * permission so callers can render a "grant location" CTA without
 * also asking expo for the permission state separately.
 */
export interface LiveUserLocation {
  lat: number;
  lon: number;
  /** Horizontal accuracy in metres, or `null` for dev-pinned positions
   *  where accuracy is meaningless (no real measurement). The map
   *  layers treat a null accuracy as "suppress the halo". */
  accuracy: number | null;
}

export interface UseLiveUserLocationResult {
  pos: LiveUserLocation | null;
  denied: boolean;
}

export interface UseLiveUserLocationOptions {
  /** Initial `pos` to seed the state with — used by callers that
   *  already have a cached anchor (e.g. `ExploreHomeScreen`'s
   *  merchant-cache anchor) so the map paints something before the
   *  GPS ladder lands. */
  initial?: LiveUserLocation | null;
  /** Accuracy hint for both the one-shot fresh fix and the ongoing
   *  watch. `Balanced` is the right default for map views (cheap on
   *  battery, ~10 m precision). Pickers / hunts that care about
   *  precision can pass `High`. */
  accuracy?: Location.LocationAccuracy;
  /** Min time between watch callbacks. Default 5 s — frequent enough
   *  that the dot feels live on foot, infrequent enough that we
   *  don't churn React state in city centres. */
  timeIntervalMs?: number;
  /** Min distance change before a watch callback fires. Default 10 m
   *  so the dot doesn't jitter while the user stands still. */
  distanceIntervalM?: number;
}

const DEFAULT_TIME_INTERVAL_MS = 5000;
const DEFAULT_DISTANCE_INTERVAL_M = 10;

export function useLiveUserLocation(
  opts: UseLiveUserLocationOptions = {},
): UseLiveUserLocationResult {
  const [pos, setPos] = useState<LiveUserLocation | null>(opts.initial ?? null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let watch: Location.LocationSubscription | null = null;

    const accuracy = opts.accuracy ?? Location.Accuracy.Balanced;
    const timeInterval = opts.timeIntervalMs ?? DEFAULT_TIME_INTERVAL_MS;
    const distanceInterval = opts.distanceIntervalM ?? DEFAULT_DISTANCE_INTERVAL_M;

    (async () => {
      // Dev-pinned location short-circuits the GPS ladder entirely.
      // Accuracy is null because the pin is a literal value, not a
      // measurement — the map layers will suppress the halo.
      const pinned = getDevPinnedLocation();
      if (pinned) {
        if (!cancelled) setPos({ lat: pinned.lat, lon: pinned.lon, accuracy: null });
        return;
      }

      const perm = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (perm.status !== 'granted') {
        setDenied(true);
        return;
      }

      // Step 1: last-known fix (instant, may be 10 min stale). Paints
      // the map while step 2 fetches a fresh one in parallel.
      try {
        const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 });
        if (!cancelled && last) {
          setPos({
            lat: last.coords.latitude,
            lon: last.coords.longitude,
            accuracy: typeof last.coords.accuracy === 'number' ? last.coords.accuracy : null,
          });
        }
      } catch {
        /* non-fatal — fall through */
      }

      // Step 2: fresh fix that overwrites the stale last-known.
      try {
        const fresh = await Location.getCurrentPositionAsync({ accuracy });
        if (!cancelled) {
          setPos({
            lat: fresh.coords.latitude,
            lon: fresh.coords.longitude,
            accuracy: typeof fresh.coords.accuracy === 'number' ? fresh.coords.accuracy : null,
          });
        }
      } catch {
        /* non-fatal — last-known stands in until the watch fires */
      }

      // Step 3: keep the dot live as the user walks around.
      try {
        watch = await Location.watchPositionAsync(
          { accuracy, timeInterval, distanceInterval },
          (update) => {
            if (cancelled) return;
            setPos({
              lat: update.coords.latitude,
              lon: update.coords.longitude,
              accuracy: typeof update.coords.accuracy === 'number' ? update.coords.accuracy : null,
            });
          },
        );
      } catch {
        /* non-fatal — the dot stops updating but the map still works */
      }
    })();

    return () => {
      cancelled = true;
      watch?.remove();
    };
    // The opts object is reconstructed each render by callers — we
    // deliberately key the effect on the primitive sub-fields only,
    // so adding `opts` itself would re-mount the watch on every
    // parent render. The accuracy / interval values are stable for
    // any given screen, so this is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.accuracy, opts.timeIntervalMs, opts.distanceIntervalM]);

  return { pos, denied };
}
