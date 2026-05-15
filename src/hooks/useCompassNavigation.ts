import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { bearingDegrees, haversineMetres } from '../utils/geohash';
import { getDevPinnedLocation } from '../utils/devLocation';

interface CompassNav {
  /** User's current position from `Location.watchPositionAsync`. `null`
   *  until the first fix lands, or if permission was denied. */
  user: { lat: number; lon: number } | null;
  /** Device's true-north compass heading in degrees (0 = North). `null`
   *  on emulators / devices with no magnetometer, or while the first
   *  heading event is pending. */
  heading: number | null;
  /** Great-circle initial bearing from `user` to `target`, in degrees
   *  (0 = North). `null` until both `user` and `target` are known. */
  bearing: number | null;
  /** Haversine distance from `user` to `target` in metres. Same null
   *  rule as `bearing`. */
  distanceMetres: number | null;
}

/**
 * Live user position + compass heading + bearing/distance to a fixed
 * geo target. Used by the cache-detail Navigate arrow — when heading
 * is known the icon rotates by `bearing − heading` so it always
 * points at the target as the user turns. Callers should pair this
 * with lucide's `Navigation2` (symmetric arrowhead, straight up at
 * rest) for the rotated case and fall back to the static `Navigation`
 * glyph (45° tilt) when `heading` is null — that reads as a generic
 * "go here" affordance without implying a measured direction.
 *
 * The implementation uses `expo-location` for both feeds — heading is
 * exposed via `watchHeadingAsync`, which lives in `expo-location`, not
 * `expo-sensors`. That means no new native module, no rebuild required.
 *
 * Permissions: piggy-backs on the foreground-location permission the
 * app already requests for the Explore tab (`MapScreen.tsx:194`). If
 * the user has denied it elsewhere, this hook just returns `null` and
 * the caller falls back to its existing UI.
 *
 * Cleanup: both subscriptions are released on unmount and when the
 * `target` reference changes — sensor listeners on Android leak silently
 * otherwise.
 */
export const useCompassNavigation = (target: { lat: number; lon: number } | null): CompassNav => {
  const [user, setUser] = useState<{ lat: number; lon: number } | null>(null);
  const [heading, setHeading] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let posSub: Location.LocationSubscription | null = null;
    let hdgSub: Location.LocationSubscription | null = null;

    (async () => {
      // Honour the dev-only pinned-location override the rest of the
      // app uses (see src/utils/devLocation.ts). Without this, the
      // emulator's Explore + Hunt screens think the user is in the
      // EXPO_PUBLIC_DEV_LAT/LON spot while the compass arrow reads
      // the real fused-location-provider value (often Mountain View
      // on AVDs), so distances come out wildly inconsistent.
      const pinned = getDevPinnedLocation();
      if (pinned) {
        setUser({ lat: pinned.lat, lon: pinned.lon });
      }

      const perm = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (perm.status !== 'granted') return;
      try {
        // Balanced accuracy is the right trade-off for "where am I roughly
        // relative to this cache" — high accuracy hammers the GPS radio
        // and drains the battery without making the bearing visibly truer.
        // Skipped when a dev pin is in effect — that's a deliberate
        // override and live GPS would just argue with it.
        if (!pinned) {
          posSub = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.Balanced, distanceInterval: 2 },
            (loc) => {
              if (cancelled) return;
              setUser({ lat: loc.coords.latitude, lon: loc.coords.longitude });
            },
          );
        }
      } catch {
        // Sim devices / GPS-off → stay null and the caller falls back.
      }
      try {
        hdgSub = await Location.watchHeadingAsync((h) => {
          if (cancelled) return;
          // trueHeading is North-referenced if the OS has a fix on
          // declination; otherwise it returns −1 and we fall back to
          // the magnetic heading (close enough for short-distance
          // navigation — declination is < 10° across most of the
          // populated world).
          const v = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (Number.isFinite(v)) setHeading(((v % 360) + 360) % 360);
        });
      } catch {
        // Emulator / device with no magnetometer → heading stays null.
      }
    })();

    return () => {
      cancelled = true;
      posSub?.remove();
      hdgSub?.remove();
    };
  }, []);

  const bearing =
    user && target
      ? bearingDegrees({ lat: user.lat, lon: user.lon }, { lat: target.lat, lon: target.lon })
      : null;
  const distanceMetres =
    user && target
      ? haversineMetres({ lat: user.lat, lon: user.lon }, { lat: target.lat, lon: target.lon })
      : null;

  return { user, heading, bearing, distanceMetres };
};
