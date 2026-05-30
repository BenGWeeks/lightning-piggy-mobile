import * as Location from 'expo-location';

export interface SharedLocation {
  lat: number;
  lon: number;
  accuracyMeters: number | null;
}

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

const COORD_DECIMALS = 5;

function roundCoord(n: number): string {
  return n.toFixed(COORD_DECIMALS);
}

/**
 * Format a location as the plain-text body of an encrypted DM. The body
 * contains both an RFC 5870 `geo:` URI (parsed back into a location card by
 * this app) and a human-readable OpenStreetMap URL (so other Nostr clients
 * render a clickable link).
 */
export function formatGeoMessage(loc: SharedLocation): string {
  const lat = roundCoord(loc.lat);
  const lon = roundCoord(loc.lon);
  const accPart = loc.accuracyMeters !== null ? `;u=${loc.accuracyMeters}` : '';
  const osmUrl = buildOsmViewUrl(loc);
  return `\u{1F4CD} Shared location\ngeo:${lat},${lon}${accPart}\n${osmUrl}`;
}

// A bare RFC 5870 geo URI is unambiguous — the scheme is reserved for
// geographic coordinates — so matching it anywhere in the message lets us
// also render location cards from other Nostr clients that might send only
// a geo URI with no OSM link.
const GEO_URI_REGEX = /\bgeo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:;u=(\d+(?:\.\d+)?))?/i;

export function parseGeoMessage(text: string): SharedLocation | null {
  if (!text) return null;
  const m = text.match(GEO_URI_REGEX);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!isFinite(lat) || !isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  // Guard the `u=` accuracy: a malicious / buggy sender could pass a very
  // large value that Number() coerces to Infinity, or a negative / nonsense
  // value. The 40 000 000 m ceiling is larger than Earth's circumference —
  // anything past it is garbage, not a real uncertainty radius.
  const ACCURACY_MAX_M = 40_000_000;
  const accRaw = m[3];
  let accuracyMeters: number | null = null;
  if (accRaw !== undefined) {
    const n = Number(accRaw);
    if (isFinite(n) && n >= 0 && n < ACCURACY_MAX_M) {
      accuracyMeters = Math.round(n);
    }
  }
  return { lat, lon, accuracyMeters };
}

export function buildOsmViewUrl(loc: SharedLocation, zoom = 16): string {
  const lat = roundCoord(loc.lat);
  const lon = roundCoord(loc.lon);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;
}

// Location-card map rendering moved to the shared MapLibre mini-map
// (`LibreMiniMap`, OpenFreeMap vector tiles) in #206 — the old single-tile
// `buildStaticMapUrl` / `USER_AGENT` helper was removed with it.

export function formatCoordsForDisplay(loc: SharedLocation): string {
  const ns = loc.lat >= 0 ? 'N' : 'S';
  const ew = loc.lon >= 0 ? 'E' : 'W';
  return `${Math.abs(loc.lat).toFixed(4)}° ${ns}, ${Math.abs(loc.lon).toFixed(4)}° ${ew}`;
}
