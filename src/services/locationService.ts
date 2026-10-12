import * as Location from 'expo-location';
import type { SharedLocation } from '../utils/geoMessage';

// Pure geo-message helpers live in utils/geoMessage (no expo-location, so
// message parsing / previews don't pull the native module in); re-exported
// here for existing importers.
export type { SharedLocation } from '../utils/geoMessage';
export {
  buildOsmViewUrl,
  formatCoordsForDisplay,
  formatGeoMessage,
  parseGeoMessage,
} from '../utils/geoMessage';

export type LocationError = 'permission_denied' | 'services_disabled' | 'timeout' | 'unknown';

export interface LocationResult {
  ok: true;
  location: SharedLocation;
}

export interface LocationFailure {
  ok: false;
  error: LocationError;
  message: string;
}

/**
 * Request foreground-location permission (if not already granted) and fetch a
 * single GPS fix. No background tracking, no watcher — one point, then done.
 */
export async function getCurrentLocation(): Promise<LocationResult | LocationFailure> {
  const enabled = await Location.hasServicesEnabledAsync();
  if (!enabled) {
    return {
      ok: false,
      error: 'services_disabled',
      message: 'Location services are turned off on this device.',
    };
  }

  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') {
    return {
      ok: false,
      error: 'permission_denied',
      message: 'Location permission is required to share your location.',
    };
  }

  // Try the cheap path first: a recent cached fix returns instantly.
  // Fall through to getCurrentPositionAsync for an active request, and
  // finally watchPositionAsync — on Android, the fused provider throws
  // ERR_CURRENT_LOCATION_IS_UNAVAILABLE when its cache is empty (emulator
  // cold start, airplane-mode recovery), so we need to actively wait for
  // a first fix rather than give up.
  const pos = (await tryLastKnown()) ?? (await tryGetCurrent()) ?? (await waitForFirstFix(15000));
  if (!pos) {
    return {
      ok: false,
      error: 'timeout',
      message: 'Could not determine your location. Try again in a moment.',
    };
  }
  return {
    ok: true,
    location: {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracyMeters:
        typeof pos.coords.accuracy === 'number' && isFinite(pos.coords.accuracy)
          ? Math.round(pos.coords.accuracy)
          : null,
    },
  };
}

async function tryLastKnown(): Promise<Location.LocationObject | null> {
  try {
    return await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
  } catch {
    return null;
  }
}

async function tryGetCurrent(): Promise<Location.LocationObject | null> {
  try {
    // Accuracy.High maps to FusedLocationProviderClient's PRIORITY_HIGH_ACCURACY,
    // which actively demands GPS. Balanced prefers the network provider, which
    // is unavailable on emulators configured with GPS only — so Balanced throws
    // ERR_CURRENT_LOCATION_IS_UNAVAILABLE on empty cache even when GPS has a fix.
    return await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  } catch {
    return null;
  }
}

function waitForFirstFix(timeoutMs: number): Promise<Location.LocationObject | null> {
  return new Promise((resolve) => {
    let settled = false;
    let subscription: Location.LocationSubscription | null = null;
    const done = (value: Location.LocationObject | null) => {
      if (settled) return;
      settled = true;
      subscription?.remove();
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 0 },
      (pos) => {
        clearTimeout(timer);
        done(pos);
      },
    )
      .then((sub) => {
        if (settled) sub.remove();
        else subscription = sub;
      })
      .catch(() => {
        clearTimeout(timer);
        done(null);
      });
  });
}
