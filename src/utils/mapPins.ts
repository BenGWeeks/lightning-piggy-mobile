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

/** Midpoint of a viewport bbox — the cap centre for the pin cap below. */
export const bboxCentre = (b: {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}): { lat: number; lon: number } => ({
  lat: (b.minLat + b.maxLat) / 2,
  lon: (b.minLon + b.maxLon) / 2,
});

/**
 * Cap a merchant list to the `max` pins nearest `centre` (the viewport
 * centre). Under the cap the list is returned as-is (no re-sort — the
 * map doesn't care about order and keeping identity avoids re-renders).
 * Without a centre (no viewport settled yet) it truncates arbitrarily —
 * bounded is the requirement, nearest is the nicety.
 */
export function capMerchantPinsToNearest(
  merchants: BtcMapPlace[],
  centre: { lat: number; lon: number } | null,
  max: number = MAX_MAP_MERCHANT_PINS,
): BtcMapPlace[] {
  if (merchants.length <= max) return merchants;
  if (!centre) return merchants.slice(0, max);
  return merchants
    .map((place) => ({
      place,
      distance: haversineMetres(centre, { lat: place.lat, lon: place.lon }),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, max)
    .map((entry) => entry.place);
}
