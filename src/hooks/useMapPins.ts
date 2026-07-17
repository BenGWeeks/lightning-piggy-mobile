import { useEffect, useMemo, useState } from 'react';
import { acceptsLightning, acceptsOnchain } from '../services/btcMapService';
import type { BtcMapPlace } from '../services/btcMapService';
import type { ParsedCache } from '../services/nostrPlacesService';
import { isHiddenInProd } from '../utils/exploreContentFilter';
import { capMerchantPinsToNearest } from '../utils/mapPins';

/**
 * Derives the pin arrays MapScreen feeds LibreMiniMap from the raw
 * fetched/subscribed data plus the filter-sheet state. Extracted from
 * MapScreen (#1067) so the screen stays composition and the derivation
 * is one nameable unit:
 *
 * - merchants: type + category filters, then capped to the pins nearest
 *   the viewport centre (`capMerchantPinsToNearest`) — an unbounded
 *   marker set is what wedged/crashed the app on zoom-out (#1067).
 * - caches: prod-hidden / pin-type / Web-of-Trust / NIP-40 expiry
 *   filters. Expiry is re-evaluated on a 60 s tick so a cache can lapse
 *   while the map sits open (#763), without a per-render `Date.now()`
 *   defeating the memo.
 * - cacheCounts: piglet/other split for the footer, computed in one
 *   pass (Copilot review on #825).
 */
export interface MapPinFilters {
  lightning: boolean;
  onchain: boolean;
  piglet: boolean;
  nipgcCache: boolean;
}

export function useMapPins(args: {
  places: BtcMapPlace[];
  cachesMap: Map<string, ParsedCache>;
  filters: MapPinFilters;
  categoryFilter: Set<string>;
  isTrusted: (pubkey: string) => boolean;
  /** Centre of the last settled viewport — reactive state (not a ref)
   *  so the merchant cap recentres even when a pan's refetch fails and
   *  `places` keeps its identity (Copilot review on #1068). */
  viewportCentre: { lat: number; lon: number } | null;
}): {
  visibleMerchants: BtcMapPlace[];
  visibleCaches: ParsedCache[];
  cacheCounts: { piglets: number; others: number };
} {
  const { places, cachesMap, filters, categoryFilter, isTrusted, viewportCentre } = args;

  const visibleMerchants = useMemo(() => {
    const filtered = places.filter((p) => {
      const typeOk = acceptsLightning(p)
        ? filters.lightning
        : acceptsOnchain(p)
          ? filters.onchain
          : filters.lightning || filters.onchain;
      if (!typeOk) return false;
      if (categoryFilter.size === 0) return true;
      const cats = p.categories ?? [];
      return cats.some((c) => categoryFilter.has(c));
    });
    return capMerchantPinsToNearest(filtered, viewportCentre);
  }, [places, filters.lightning, filters.onchain, categoryFilter, viewportCentre]);

  // Re-evaluate the NIP-40 expiry filter as time advances even if nothing
  // else changes — a cache can expire while the map just sits open. A 60 s
  // tick is plenty (expiry is a slow day/year-scale boundary) and, unlike
  // putting a per-render `Date.now()` in the memo deps (which would
  // recompute visibleCaches every render), keeps the memo cached between
  // ticks (#763).
  const [nowSec, setNowSec] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNowSec(Date.now() / 1000), 60_000);
    return () => clearInterval(t);
  }, []);

  const visibleCaches = useMemo(() => {
    // Drop NIP-40-expired caches — relays that don't honour expiration keep
    // serving them, so the client filters them out. The Geo-caches list
    // (HuntScreen) already does this; the map must too, else an expired
    // Piglet lingers on the map after it's gone from the list (#762).
    return [...cachesMap.values()].filter(
      (c) =>
        !isHiddenInProd(c.hiderPubkey) &&
        (c.isLpPiggy ? filters.piglet : filters.nipgcCache) &&
        isTrusted(c.hiderPubkey) &&
        (c.expiresAt === null || c.expiresAt > nowSec),
    );
  }, [cachesMap, filters.piglet, filters.nipgcCache, isTrusted, nowSec]);

  // One pass instead of filtering the cache map twice per render
  // (Copilot review on #825).
  const cacheCounts = useMemo(() => {
    let piglets = 0;
    let others = 0;
    for (const c of cachesMap.values()) {
      if (c.isLpPiggy) piglets++;
      else others++;
    }
    return { piglets, others };
  }, [cachesMap]);

  return { visibleMerchants, visibleCaches, cacheCounts };
}
