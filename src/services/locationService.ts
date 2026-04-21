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

  try {
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
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
  } catch {
    return {
      ok: false,
      error: 'unknown',
      message: 'Could not determine your location. Try again in a moment.',
    };
  }
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
  const accRaw = m[3];
  const accuracyMeters = accRaw !== undefined ? Math.round(Number(accRaw)) : null;
  return { lat, lon, accuracyMeters };
}

export function buildOsmViewUrl(loc: SharedLocation, zoom = 16): string {
  const lat = roundCoord(loc.lat);
  const lon = roundCoord(loc.lon);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;
}

/**
 * URL for a PNG thumbnail of the shared coordinates. Uses the OSM-DE
 * community static-map service — no API key, no Google. The recipient's
 * device fetches this once per unique (lat,lon) and it lands in the
 * `expo-image` disk cache, so repeat views don't re-contact the tile host.
 */
export function buildStaticMapUrl(
  loc: SharedLocation,
  opts: { width?: number; height?: number; zoom?: number } = {},
): string {
  const width = opts.width ?? 400;
  const height = opts.height ?? 220;
  const zoom = opts.zoom ?? 15;
  const lat = roundCoord(loc.lat);
  const lon = roundCoord(loc.lon);
  return (
    `https://staticmap.openstreetmap.de/staticmap.php` +
    `?center=${lat},${lon}` +
    `&zoom=${zoom}` +
    `&size=${width}x${height}` +
    `&maptype=mapnik` +
    `&markers=${lat},${lon},lightblue1`
  );
}

export function formatCoordsForDisplay(loc: SharedLocation): string {
  const lat = loc.lat.toFixed(4);
  const lon = loc.lon.toFixed(4);
  const ns = loc.lat >= 0 ? 'N' : 'S';
  const ew = loc.lon >= 0 ? 'E' : 'W';
  return `${Math.abs(Number(lat)).toFixed(4)}° ${ns}, ${Math.abs(Number(lon)).toFixed(4)}° ${ew}`;
}
