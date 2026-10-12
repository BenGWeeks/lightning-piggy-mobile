// Pure `geo:` location-message helpers (#206), split from locationService so
// message parsing, previews and the background DM path never load
// expo-location (#1300).

export interface SharedLocation {
  lat: number;
  lon: number;
  accuracyMeters: number | null;
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
