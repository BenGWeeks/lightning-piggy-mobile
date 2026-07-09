/**
 * Value-equality for GPS fixes, used by `useLiveUserLocation` to decide
 * whether a newly-delivered fix is worth publishing through
 * `UserLocationContext`.
 *
 * Why this exists (the sporadic-freeze trigger): Android's location
 * providers redeliver fixes on the watch's `timeInterval` cadence even when
 * the device hasn't moved — same coordinates, fresh `timestamp`. And on real
 * hardware, GPS jitter makes a stationary phone emit coordinates that differ
 * by centimetres from sample to sample. Publishing each of those as a new
 * `pos` object re-renders EVERY mounted map consumer of the context
 * (ExploreHomeScreen alone measured 300–700 ms per commit), so a phone
 * sitting still could pay a multi-hundred-ms JS-thread stall on every watch
 * tick — felt as "the tabs randomly stop responding".
 *
 * Two fixes are "the same place" when:
 *  - lat/lon match to 5 decimal places (~1.1 m at the equator) — below the
 *    accuracy of consumer GPS, so treating sub-metre drift as identical
 *    loses nothing for the map surfaces (their dot is drawn 10s of pixels
 *    wide at typical zooms);
 *  - the accuracy halo lands in the same 5 m bucket — accuracy flutters
 *    (±0.5 m sample-to-sample) far faster than it matters visually, and
 *    including raw accuracy in the comparison would defeat the dedupe.
 */
export interface LocationFixLike {
  lat: number;
  lon: number;
  /** Horizontal accuracy in metres, or null when unreported. */
  accuracy: number | null;
}

// ~1.1 m — one digit finer than the ~11 m granularity the map dot can show.
const COORD_DECIMALS = 5;
// Accuracy halo granularity in metres.
const ACCURACY_BUCKET_M = 5;

export function isSameFix(a: LocationFixLike, b: LocationFixLike): boolean {
  if (a.lat.toFixed(COORD_DECIMALS) !== b.lat.toFixed(COORD_DECIMALS)) return false;
  if (a.lon.toFixed(COORD_DECIMALS) !== b.lon.toFixed(COORD_DECIMALS)) return false;
  const bucketA = a.accuracy === null ? null : Math.round(a.accuracy / ACCURACY_BUCKET_M);
  const bucketB = b.accuracy === null ? null : Math.round(b.accuracy / ACCURACY_BUCKET_M);
  return bucketA === bucketB;
}
