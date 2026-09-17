/**
 * Tiny geohash encoder. Used for the `g` tag on the NIP-GC kind 37516
 * cache listings (Hunt Piggies + treasures.to / TapTheSatsMap caches)
 * and on NIP-52 kind 31923 calendar events. 7-char default precision
 * ≈ 153 m × 153 m — fine for "near this bench" hints; the hub /
 * Discover queries widen via prefix using `geohashPrefixes`.
 *
 * Algorithm + base-32 alphabet from Niemeyer's original spec
 * (en.wikipedia.org/wiki/Geohash). No deps.
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export const encodeGeohash = (lat: number, lon: number, precision = 7): string => {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('encodeGeohash: lat / lon must be finite numbers');
  }
  let latLo = -90;
  let latHi = 90;
  let lonLo = -180;
  let lonHi = 180;
  let bit = 0;
  let ch = 0;
  let evenBit = true;
  let out = '';
  while (out.length < precision) {
    if (evenBit) {
      const mid = (lonLo + lonHi) / 2;
      if (lon >= mid) {
        ch |= 1 << (4 - bit);
        lonLo = mid;
      } else {
        lonHi = mid;
      }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat >= mid) {
        ch |= 1 << (4 - bit);
        latLo = mid;
      } else {
        latHi = mid;
      }
    }
    evenBit = !evenBit;
    if (bit < 4) {
      bit += 1;
    } else {
      out += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return out;
};

/**
 * Returns successively coarser prefixes of a geohash, useful for
 * Nostr filter queries — `["g", prefix]` filters that match by
 * prefix yield "events anywhere in this 5km box" without us having
 * to enumerate cells.
 */
export const geohashPrefixes = (gh: string, minLen = 3): string[] => {
  const out: string[] = [];
  for (let i = gh.length; i >= minLen; i -= 1) out.push(gh.slice(0, i));
  return out;
};

/**
 * Returns the geohash cell + its 8 immediate neighbours at the same
 * precision. Used by the Explore "nearby" subscriptions to widen the
 * `#g` filter beyond the user's single tile — a cache hidden 200 m
 * across a tile boundary would otherwise be invisible (issue #631).
 *
 * Implementation: decode the cell's bounding box, walk a 3×3 grid of
 * centroids one cell-width apart in each direction, encode at the
 * same precision. The Set dedupes pole / antimeridian wrap-arounds.
 *
 * Returns 9 entries (or fewer at the poles where some grid positions
 * collapse). Order isn't meaningful — the receiver Set-includes them.
 */
export const geohashNeighbours = (gh: string): string[] => {
  if (gh.length === 0) return [];
  let latLo = -90;
  let latHi = 90;
  let lonLo = -180;
  let lonHi = 180;
  let evenBit = true;
  for (let i = 0; i < gh.length; i += 1) {
    const idx = BASE32.indexOf(gh[i].toLowerCase());
    if (idx < 0) continue;
    for (let bit = 4; bit >= 0; bit -= 1) {
      const set = (idx >> bit) & 1;
      if (evenBit) {
        const mid = (lonLo + lonHi) / 2;
        if (set) lonLo = mid;
        else lonHi = mid;
      } else {
        const mid = (latLo + latHi) / 2;
        if (set) latLo = mid;
        else latHi = mid;
      }
      evenBit = !evenBit;
    }
  }
  const latStep = latHi - latLo;
  const lonStep = lonHi - lonLo;
  const lat = (latLo + latHi) / 2;
  const lon = (lonLo + lonHi) / 2;
  const out = new Set<string>();
  for (let dLat = -1; dLat <= 1; dLat += 1) {
    for (let dLon = -1; dLon <= 1; dLon += 1) {
      const nLat = lat + dLat * latStep;
      // Skip past-pole positions (no valid neighbour past ±90°).
      if (nLat > 90 || nLat < -90) continue;
      // Wrap longitude across the antimeridian so neighbours of u… and
      // z… at the dateline still resolve.
      let nLon = lon + dLon * lonStep;
      if (nLon > 180) nLon -= 360;
      else if (nLon < -180) nLon += 360;
      out.add(encodeGeohash(nLat, nLon, gh.length));
    }
  }
  return [...out];
};

/**
 * Decode a geohash to its centroid `{lat, lng}`. Inverse of
 * `encodeGeohash`. Returns the geometric centre of the cell, not a
 * corner — that's what the consumers (map pins, distance sort) want.
 */
export const decodeGeohash = (gh: string): { lat: number; lng: number } => {
  let latLo = -90;
  let latHi = 90;
  let lonLo = -180;
  let lonHi = 180;
  let evenBit = true;
  for (let i = 0; i < gh.length; i += 1) {
    const idx = BASE32.indexOf(gh[i].toLowerCase());
    if (idx < 0) continue;
    for (let bit = 4; bit >= 0; bit -= 1) {
      const set = (idx >> bit) & 1;
      if (evenBit) {
        const mid = (lonLo + lonHi) / 2;
        if (set) lonLo = mid;
        else lonHi = mid;
      } else {
        const mid = (latLo + latHi) / 2;
        if (set) latLo = mid;
        else latHi = mid;
      }
      evenBit = !evenBit;
    }
  }
  return { lat: (latLo + latHi) / 2, lng: (lonLo + lonHi) / 2 };
};

/**
 * Great-circle distance in metres between two (lat, lon) points,
 * via the haversine formula. We use this to sort the Hub / Discover
 * / Events rails by proximity to the user. Accuracy is plenty for
 * "X km away" copy — within 0.5 % on city-scale distances.
 */
export const haversineMetres = (
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number => {
  const R = 6_371_000; // mean Earth radius in metres
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sa = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(sa)));
};

/**
 * Initial great-circle bearing in degrees (0 = North, 90 = East, …, 360
 * excluded) from point `a` to point `b`. Used by the cache-detail
 * Navigate arrow — rotating the icon by `bearing − deviceHeading`
 * keeps it pointing at the cache as the user turns. "Initial" means
 * the bearing you'd set off on; for short walking distances (the only
 * case this app cares about) it's effectively constant en-route.
 *
 * Returns 0 if the two points are identical (atan2 would otherwise
 * return whatever atan2(0,0) yields on the platform).
 */
export const bearingDegrees = (
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number => {
  if (a.lat === b.lat && a.lon === b.lon) return 0;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const toDeg = (rad: number): number => (rad * 180) / Math.PI;
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
};

/**
 * Human-readable distance string. Used as the "X away" badge on
 * Hub / Discover / Events rows.
 *   < 950 m  → "210 m" (rounded to nearest 10 m)
 *   < 10 km  → "3.2 km"
 *   ≥ 10 km  → "42 km"
 */
export const formatDistance = (metres: number): string => {
  if (!Number.isFinite(metres) || metres < 0) return '';
  // Rounding to nearest 10 m floors any value < 5 m to "0 m", which
  // reads as broken even when the cache is genuinely 1-2 m away
  // (typical in dev with a pinned location matching a fixture cache).
  // Surface a friendlier "< 5 m" instead.
  if (metres < 5) return '< 5 m';
  if (metres < 950) {
    const rounded = Math.round(metres / 10) * 10;
    return `${rounded} m`;
  }
  const km = metres / 1000;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
};

/**
 * Geohash prefixes covering a viewport bbox, for NIP-GC `#g` filters
 * (#1065).
 *
 * `#g` is exact-match, so the returned tiles must sit at a precision the
 * publishers actually tag — LP (and treasures.to-compatible clients)
 * emit `g` at precisions 3–9, hence the 3..5 walk here. Starting from
 * `maxPrecision` (small tiles) and coarsening until the covering set
 * fits `maxTiles` keeps the relay filter bounded at any zoom. When even
 * the coarsest precision can't cover the viewport within budget (a
 * continental / world zoom), fall back to the tile under the viewport
 * centre plus its 8 neighbours — mirroring the merchant fetch's
 * radius-clamp semantics: "load around the view centre, not the world".
 * Antimeridian-crossing bboxes take the fallback path too (the step
 * enumeration doesn't wrap; MapLibre viewports in practice don't cross
 * it for our markets).
 */
export const geohashPrefixesForBbox = (
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number },
  maxTiles = 9,
  maxPrecision = 5,
  minPrecision = 3,
): string[] => {
  // Cell size in degrees at precision p: 5 bits/char alternating
  // lon-first → lon gets ceil(5p/2) bits, lat gets floor(5p/2).
  const cellSize = (p: number): { lonDeg: number; latDeg: number } => {
    const bits = 5 * p;
    const lonBits = Math.ceil(bits / 2);
    const latBits = Math.floor(bits / 2);
    return { lonDeg: 360 / 2 ** lonBits, latDeg: 180 / 2 ** latBits };
  };
  const centreFallback = (): string[] => {
    const lat = (bbox.minLat + bbox.maxLat) / 2;
    // Wrapped mid-longitude: an antimeridian-crossing bbox (minLon >
    // maxLon) averages to the wrong side of the planet with a plain
    // (min+max)/2 — e.g. 170..-170 → 0. Add a turn before halving,
    // then normalise back into [-180, 180).
    const rawLon =
      bbox.minLon > bbox.maxLon
        ? (bbox.minLon + bbox.maxLon + 360) / 2
        : (bbox.minLon + bbox.maxLon) / 2;
    const lon = ((rawLon + 540) % 360) - 180;
    const centre = encodeGeohash(lat, lon, minPrecision);
    // Centre tile first so a slice can never drop the one tile that
    // matters most (geohashNeighbours' ordering is unspecified).
    return [centre, ...geohashNeighbours(centre).filter((t) => t !== centre)].slice(0, maxTiles);
  };
  if (bbox.minLon > bbox.maxLon || bbox.minLat > bbox.maxLat) return centreFallback();
  for (let p = maxPrecision; p >= minPrecision; p -= 1) {
    const { lonDeg, latDeg } = cellSize(p);
    // Iterate cell INDICES (floor(min/cell) .. floor(max/cell), inclusive)
    // rather than stepping centres against a float bound — index iteration
    // always yields ≥1 cell per axis, so a degenerate bbox (min == max,
    // even sitting exactly on a grid line) still covers the tile
    // containing the point instead of returning an empty set.
    const latLo = Math.floor(bbox.minLat / latDeg);
    const latHi = Math.floor(bbox.maxLat / latDeg);
    const lonLo = Math.floor(bbox.minLon / lonDeg);
    const lonHi = Math.floor(bbox.maxLon / lonDeg);
    const tiles: string[] = [];
    let overflow = false;
    for (let li = latLo; li <= latHi && !overflow; li += 1) {
      for (let lj = lonLo; lj <= lonHi; lj += 1) {
        const clampedLat = Math.max(-90, Math.min(90, li * latDeg + latDeg / 2));
        const clampedLon = Math.max(-180, Math.min(180, lj * lonDeg + lonDeg / 2));
        const gh = encodeGeohash(clampedLat, clampedLon, p);
        if (!tiles.includes(gh)) tiles.push(gh);
        if (tiles.length > maxTiles) {
          overflow = true;
          break;
        }
      }
    }
    if (!overflow) return tiles;
  }
  return centreFallback();
};
