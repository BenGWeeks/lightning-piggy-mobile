// Stale-while-revalidate for the market catalogue. A refresh that hears from
// only some relays must not shrink the grid: a listing stays until a relay
// that holds it answers without it (or a NIP-09 deletion / expiry removes it).
import type { Event } from 'nostr-tools';
import type { MarketProduct } from '../data/marketProducts';
import type { MarketListingsResult } from '../services/marketListingsService';

/** Same display cap as the listings service. */
export const MARKET_MERGE_CAP = 250;

const createdAt = (product: MarketProduct) => product.listing?.event.created_at ?? -Infinity;

/** NIP-01 replaceable ordering: newer `created_at` wins, ties go to the lowest id. */
function supersedes(a: Event, b: Event): boolean {
  return a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);
}

/**
 * The fresh products, except where we already hold a newer revision of the
 * same listing — a relay serving an older (still validly signed) revision
 * while the one with the latest is offline must not roll the listing back.
 */
function newestRevisions(held: readonly MarketProduct[], fresh: readonly MarketProduct[]) {
  // One id index per merge (a fetch round), not a per-event Map clone.
  const heldById = new Map(held.map((product) => [product.id, product]));
  return fresh.map((product) => {
    const old = heldById.get(product.id);
    return old?.listing && product.listing && supersedes(old.listing.event, product.listing.event)
      ? old
      : product;
  });
}

/**
 * Previous listings this round couldn't have seen: every relay that served
 * them stayed silent. Listings without provenance (older cached snapshots)
 * are kept only when no relay answered at all.
 */
function carriedOver(previous: readonly MarketProduct[], next: MarketListingsResult) {
  const answered = new Set(next.answeredRelays ?? []);
  const ruled = new Set([...next.products.map((p) => p.id), ...(next.withdrawn ?? [])]);
  return previous.filter((product) => {
    if (ruled.has(product.id)) return false;
    if (answered.size === 0) return true;
    const relays = product.listing?.seenOn ?? [];
    return relays.length > 0 && relays.every((relay) => !answered.has(relay));
  });
}

/**
 * Merge a fresh snapshot over the previous one. The fresh result always wins
 * for anything it ruled on; carried listings only fill spare capacity under
 * the display cap, newest first, so the merged set stays bounded.
 */
export function mergeMarketSnapshot(
  previous: readonly MarketProduct[],
  next: MarketListingsResult,
): MarketProduct[] {
  // A result without relay outcomes (legacy envelope) can't tell a silent
  // relay from an empty one: keep the old replace semantics, except that a
  // transport failure never wipes what's on screen.
  if (next.answeredRelays === undefined)
    return next.transportFailed && next.products.length === 0 ? [...previous] : next.products;
  if (previous.length === 0) return next.products;
  // A withdrawn listing (e.g. its newest revision deleted by the author) is
  // gone: neither the withdrawn cached revision nor an older fetched fallback
  // of the same listing may reappear.
  const withdrawn = new Set(next.withdrawn ?? []);
  const supersededByWithdrawn = new Set(
    previous
      .filter((product) => withdrawn.has(product.id))
      .flatMap((old) => {
        const fetched = next.products.find((product) => product.id === old.id);
        return old.listing &&
          fetched?.listing &&
          supersedes(old.listing.event, fetched.listing.event)
          ? [old.id]
          : [];
      }),
  );
  const fresh = newestRevisions(
    previous.filter((product) => !withdrawn.has(product.id)),
    next.products.filter((product) => !supersededByWithdrawn.has(product.id)),
  );
  const room = Math.max(0, MARKET_MERGE_CAP - fresh.length);
  const carried = carriedOver(previous, next)
    .sort((a, b) => createdAt(b) - createdAt(a))
    .slice(0, room);
  if (carried.length === 0) return fresh;
  return [...fresh, ...carried].sort(
    (a, b) => createdAt(b) - createdAt(a) || a.id.localeCompare(b.id),
  );
}

/** Listing events of the products still shown — pass 2 checks their deletions. */
export function carriedListingEvents(products: readonly MarketProduct[]): Event[] {
  return products.flatMap((product) => (product.listing ? [product.listing.event] : []));
}
