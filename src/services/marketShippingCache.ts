// Session cache over `fetchShippingOptionsForDisplay` for the Market's
// Ships-to filter: resolves a whole page of listings' kind-30406 coordinates
// in batched queries and remembers each answer (including "not published"),
// so re-focusing the Market or scrolling never re-queries per card.
import {
  fetchShippingOptionsForDisplay,
  MAX_DISPLAY_SHIPPING_REFERENCES,
} from './marketShippingService';
import type { ShippingOption } from '../utils/marketShipping';

/** Sellers rarely edit shipping; ten minutes keeps a long browse cheap. */
const TTL_MS = 10 * 60_000;
/** A miss may just be a slow relay (the display fetch doesn't fail on
 * timeout), so "not published" is re-checked sooner. */
const MISS_TTL_MS = 2 * 60_000;
/** Bound memory for a long session across many friends' shops. */
const MAX_ENTRIES = 2000;

interface Entry {
  option: ShippingOption | null;
  at: number;
}

const cache = new Map<string, Entry>();

/** The cached answer for a coordinate: the option, `null` when the seller
 * doesn't publish it, `undefined` when unknown or expired. */
export function cachedShippingOption(
  coordinate: string,
  now = Date.now(),
): ShippingOption | null | undefined {
  const entry = cache.get(coordinate);
  if (!entry) return undefined;
  if (now - entry.at > (entry.option ? TTL_MS : MISS_TTL_MS)) {
    cache.delete(coordinate);
    return undefined;
  }
  return entry.option;
}

function remember(coordinate: string, option: ShippingOption | null, now: number) {
  cache.delete(coordinate);
  cache.set(coordinate, { option, at: now });
  // Map iteration is insertion order: drop the oldest answers first.
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}

/**
 * Resolve every coordinate: cached answers immediately, the rest in one
 * batched fetch of at most 200 uncached references. Returns an entry per
 * coordinate (`null` = unresolved for this display); overflow is never cached
 * as unpublished. Rejects when the relay set entirely fails —
 * nothing is cached then, so the next call retries.
 */
export async function resolveShippingOptions(input: {
  coordinates: readonly string[];
  relays: string[];
  signal?: AbortSignal;
}): Promise<Map<string, ShippingOption | null>> {
  const now = Date.now();
  const resolved = new Map<string, ShippingOption | null>();
  const missing: string[] = [];
  for (const coordinate of new Set(input.coordinates)) {
    const cached = cachedShippingOption(coordinate, now);
    if (cached === undefined) missing.push(coordinate);
    else resolved.set(coordinate, cached);
  }
  if (missing.length === 0) return resolved;
  const requested = missing.slice(0, MAX_DISPLAY_SHIPPING_REFERENCES);
  const options = await fetchShippingOptionsForDisplay({
    coordinates: requested,
    relays: input.relays,
    signal: input.signal,
  });
  // An aborted fetch may have stopped early; don't record its gaps as "not
  // published".
  if (input.signal?.aborted) return resolved;
  const byCoordinate = new Map(options.map((option) => [option.coordinate, option]));
  // Overflow stays unknown for this display, but is not a cached relay miss:
  // the next focus can fetch it after the earlier references are cached.
  const queried = new Set(requested);
  for (const coordinate of missing) {
    const option = byCoordinate.get(coordinate) ?? null;
    if (queried.has(coordinate)) remember(coordinate, option, now);
    resolved.set(coordinate, option);
  }
  return resolved;
}

/** Test seam: forget every cached answer. */
export function clearShippingOptionCache(): void {
  cache.clear();
}
