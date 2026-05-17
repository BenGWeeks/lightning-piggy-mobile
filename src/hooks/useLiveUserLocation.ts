import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';

/**
 * Live user-location subscription for map views.
 *
 * Every map surface in the app (Explore hub, MapScreen, PlacesScreen,
 * EventsScreen, HuntScreen, PlaceDetailScreen, LocationPickerSheet)
 * had its own one-shot `getCurrentPositionAsync` at mount, so the
 * user dot froze at wherever they were when the screen opened —
 * walking around with a map open did not move the dot.
 *
 * This hook replaces that pattern with a permission check followed
 * by a three-step ladder that keeps `pos` fresh as the user moves:
 *   1. `getLastKnownPositionAsync` → near-instant cached fix so the
 *      map paints content while a fresh fix lands in parallel.
 *   2. `getCurrentPositionAsync` → fresh fix to overwrite the stale
 *      last-known (often a few streets away in the same town —
 *      that's what #595 was about).
 *   3. `watchPositionAsync` → ongoing updates every ~5s / 10m so the
 *      user dot follows them as they walk around.
 *
 * `denied` flips when the user has rejected the foreground-location
 * permission so callers can render a "grant location" CTA without
 * also asking expo for the permission state separately.
 *
 * Emulator note: on stock AVDs without Google Play Services, the
 * default FusedLocationProvider (FLP — see docs/TERMS.adoc) returns
 * null and `adb emu geo fix` injection never propagates. The
 * `Accuracy.High` default forces PRIORITY_HIGH_ACCURACY which falls
 * through to the raw LocationManager GPS provider in that case.
 */
export interface LiveUserLocation {
  lat: number;
  lon: number;
  /** Horizontal accuracy in metres, or `null` when the platform
   *  doesn't report it. The map layers treat null as "suppress the
   *  halo". */
  accuracy: number | null;
}

export interface UseLiveUserLocationResult {
  pos: LiveUserLocation | null;
  denied: boolean;
}

export interface UseLiveUserLocationOptions {
  /** When false the hook is a no-op — no permission request, no GPS
   *  calls, no watch subscription. Used by `UserLocationProvider` to
   *  make the shared subscription lazy: the hook always runs (so the
   *  React tree stays stable) but only fires up real GPS once at
   *  least one map screen has retained it. */
  enabled?: boolean;
  /** Initial `pos` to seed the state with — used by callers that
   *  already have a cached anchor (e.g. `ExploreHomeScreen`'s
   *  merchant-cache anchor) so the map paints something before the
   *  GPS ladder lands. */
  initial?: LiveUserLocation | null;
  /** Accuracy hint for both the one-shot fresh fix and the ongoing
   *  watch. Defaults to `High` — this maps to Android's
   *  `PRIORITY_HIGH_ACCURACY`, which on de-googled devices and on
   *  emulator images without Google Play Services falls through to
   *  the raw `LocationManager.GPS_PROVIDER` instead of Google's
   *  FusedLocationProvider (which returns null fixes without GMS).
   *  See docs/TERMS.adoc → `FLP` / `GMS`. Battery impact is small
   *  for a foreground map screen; if you need to be frugal pass
   *  `Balanced` explicitly (callers without a map-on-screen). */
  accuracy?: Location.LocationAccuracy;
  /** Min time between watch callbacks. Default 5 s — frequent enough
   *  that the dot feels live on foot, infrequent enough that we
   *  don't churn React state in city centres. */
  timeIntervalMs?: number;
  /** Min distance change before a watch callback fires. Default 10 m
   *  so the dot doesn't jitter while the user stands still. */
  distanceIntervalM?: number;
}

// 30 s / 50 m. Frequent enough that walking outside shrinks the
// halo + moves the dot within a couple of footsteps' worth of pace,
// rare enough that the per-tick setState pressure on the JS thread
// is negligible. Tuned with Ben after the initial 5 s / 10 m default
// caused too many React renders on dense map screens.
const DEFAULT_TIME_INTERVAL_MS = 30000;
const DEFAULT_DISTANCE_INTERVAL_M = 50;

export function useLiveUserLocation(
  opts: UseLiveUserLocationOptions = {},
): UseLiveUserLocationResult {
  const [pos, setPos] = useState<LiveUserLocation | null>(opts.initial ?? null);
  const [denied, setDenied] = useState(false);

  // Latest applied fix timestamp. Both the parallel one-shot and the
  // watch can race — without ordering they could overwrite each
  // other (e.g. watch delivers a fresh fix first, then the one-shot
  // resolves with an OLDER LocationObject.timestamp). Track the
  // latest applied timestamp in a ref and drop any update that's
  // older. The ref outlives renders so the comparison stays
  // consistent across both update channels.
  const lastTimestampRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;
    let watch: Location.LocationSubscription | null = null;

    if (opts.enabled === false) return;
    const accuracy = opts.accuracy ?? Location.Accuracy.High;
    const timeInterval = opts.timeIntervalMs ?? DEFAULT_TIME_INTERVAL_MS;
    const distanceInterval = opts.distanceIntervalM ?? DEFAULT_DISTANCE_INTERVAL_M;

    // Shared helper — apply a Location.LocationObject if and only if
    // its timestamp is newer than the last one we applied. Falls
    // back to Date.now() when the platform didn't report a
    // timestamp (rare).
    const applyIfNewer = (fix: Location.LocationObject) => {
      const ts = typeof fix.timestamp === 'number' ? fix.timestamp : Date.now();
      if (ts <= lastTimestampRef.current) return;
      lastTimestampRef.current = ts;
      setPos({
        lat: fix.coords.latitude,
        lon: fix.coords.longitude,
        accuracy: typeof fix.coords.accuracy === 'number' ? fix.coords.accuracy : null,
      });
    };

    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (perm.status !== 'granted') {
        setDenied(true);
        return;
      }

      // Step 1: last-known fix (instant, may be 10 min stale). Paints
      // the map while the parallel fetch + watch land below.
      try {
        const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 });
        if (!cancelled && last) applyIfNewer(last);
      } catch {
        /* non-fatal — fall through */
      }

      // Step 2 + 3: kick off the fresh one-shot AND the watch in
      // parallel. Awaiting the one-shot before the watch let
      // `getCurrentPositionAsync` stalls (an Android quirk that
      // already bit us in `locationService.ts`) silently block the
      // live subscription forever — so the dot would freeze on the
      // last-known fix and never update.
      Location.getCurrentPositionAsync({ accuracy })
        .then((fresh) => {
          if (cancelled) return;
          applyIfNewer(fresh);
        })
        .catch(() => {
          /* non-fatal — last-known stands in until the watch fires */
        });

      try {
        const sub = await Location.watchPositionAsync(
          { accuracy, timeInterval, distanceInterval },
          (update) => {
            if (cancelled) return;
            applyIfNewer(update);
          },
        );
        // Race: if the component unmounted while watchPositionAsync
        // was resolving, the cleanup at the bottom of this effect
        // already ran (watch was still `null` at that point). The
        // newly-resolved subscription would then be orphaned and
        // leak GPS forever. Remove it inline before assigning.
        if (cancelled) {
          sub.remove();
        } else {
          watch = sub;
        }
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
  }, [opts.enabled, opts.accuracy, opts.timeIntervalMs, opts.distanceIntervalM]);

  return { pos, denied };
}
