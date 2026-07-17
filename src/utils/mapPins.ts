import { haversineMetres } from './geohash';
import type { BtcMapPlace } from '../services/btcMapService';

/**
 * Upper bound on merchant pins rendered on a map at once (#1067).
 *
 * Pins are RN-rendered `<Marker>` views (see the LibreMiniMap header
 * comment), so an unbounded set wedges the JS thread on reconciliation
 * and balloons memory — a continental zoom-out fetched 6,344 merchants
 * and measured 3.2 GB PSS on the emulator before the OS would have
 * killed a real device. 250 keeps city-level browsing untouched (dense
 * viewports rarely exceed a few hundred) while bounding the worst case.
 * The real fix — MapLibre SymbolLayer sprites + clustering — is the
 * density follow-up already noted in LibreMiniMap.
 */
export const MAX_MAP_MERCHANT_PINS = 250;

/**
 * Same bound for cache pins. Caches accumulate across visited viewports
 * (the coalesced store deliberately never drops entries — clearing it
 * would purge the user's own one-shot by-author Piglets), so a long pan
 * session could otherwise re-grow an unbounded RN-marker set. Data
 * stays; only rendering is capped to the nearest-N.
 */
export const MAX_MAP_CACHE_PINS = 250;

/**
 * Midpoint of a viewport bbox — the cap centre for the pin cap below.
 * The longitude midpoint is wrapped: an antimeridian-crossing bbox
 * (minLon > maxLon) would average to the wrong side of the planet with
 * a plain (min+max)/2 (170..-170 → 0), mis-centring the cap. Same
 * treatment as geohashPrefixesForBbox's fallback centre.
 */
export const bboxCentre = (b: {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}): { lat: number; lon: number } => {
  const rawLon = b.minLon > b.maxLon ? (b.minLon + b.maxLon + 360) / 2 : (b.minLon + b.maxLon) / 2;
  return {
    lat: (b.minLat + b.maxLat) / 2,
    lon: ((rawLon + 540) % 360) - 180,
  };
};

/**
 * Cap a pin list to the `max` items nearest `centre` (the viewport
 * centre). Under the cap the list is returned as-is (no re-sort — the
 * map doesn't care about order and keeping identity avoids re-renders).
 * Without a centre (no viewport settled yet) it truncates arbitrarily —
 * bounded is the requirement, nearest is the nicety. Items whose
 * position can't be resolved sort last (they're unplottable anyway).
 */
export function capPinsToNearest<T>(
  items: T[],
  centre: { lat: number; lon: number } | null,
  max: number,
  positionOf: (item: T) => { lat: number; lon: number } | null,
): T[] {
  if (items.length <= max) return items;
  if (!centre) return items.slice(0, max);
  return items
    .map((item) => {
      const pos = positionOf(item);
      return {
        item,
        distance: pos ? haversineMetres(centre, pos) : Number.POSITIVE_INFINITY,
      };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, max)
    .map((entry) => entry.item);
}

/** Merchant-typed wrapper over {@link capPinsToNearest}. */
export function capMerchantPinsToNearest(
  merchants: BtcMapPlace[],
  centre: { lat: number; lon: number } | null,
  max: number = MAX_MAP_MERCHANT_PINS,
): BtcMapPlace[] {
  return capPinsToNearest(merchants, centre, max, (place) => ({
    lat: place.lat,
    lon: place.lon,
  }));
}
