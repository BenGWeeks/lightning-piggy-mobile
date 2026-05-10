/**
 * Tiny geohash encoder/decoder. Used for the `g` tag on kind-30408
 * Piggy events and kind-31923 calendar events (NIP-52). 7-char default
 * precision ≈ 153 m × 153 m — fine for "near this bench" hints.
 *
 * Algorithm + base-32 alphabet from Niemeyer's original spec
 * (en.wikipedia.org/wiki/Geohash). No deps; we don't need decoder
 * symmetry beyond what tests need.
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
