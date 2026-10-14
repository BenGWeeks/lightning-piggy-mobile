// Spam hygiene for the Market's experimental "All" seller scope — listings
// from anyone, with no author filter. Pure (no I/O) so the rules are
// unit-testable.
//
// Rules (a listing must pass all of them):
//   1. A title, a positive price and at least one image. Title and a valid
//      price are already required by `parseMarketListing`; All also demands
//      an image and rejects free (0-priced) listings, the cheapest spam.
//   2. At most OPEN_SCOPE_PER_AUTHOR listings per seller (their newest), so
//      one prolific account can't flood the grid.
//   3. Sellers without a kind-0 profile are dropped — applied in the hook
//      once profiles resolve (`withKnownProfiles`), since the profile pass
//      already runs for every listed seller.
//
// Rules 1-2 run twice: on raw events BEFORE signature checks (so a flood
// can't buy verification work — `curateOpenListingEvents`) and on the final
// products (`curateOpenListingProducts`), because a forged newest revision
// that fails verification lets an older revision win.
import type { Event } from 'nostr-tools';
import type { MarketProduct } from '../data/marketProducts';
import { parseMarketListing } from './marketListings';

/** Newest listings kept per seller in the All scope. */
export const OPEN_SCOPE_PER_AUTHOR = 10;

const tagValue = (event: Event, name: string) => event.tags.find((t) => t[0] === name)?.[1];

/** Rule 1 on a parsed listing: image present and price above zero. */
export function passesOpenScopeHygiene(product: MarketProduct): boolean {
  if (!product.title.trim() || !product.image) return false;
  const amount = Number.parseFloat(product.listing?.priceLabel ?? product.priceFiatLabel);
  return Number.isFinite(amount) && amount > 0;
}

/** Newest revision first; on a tie the lowest id (the reducer's order). */
const newerFirst = (a: Event, b: Event) =>
  b.created_at - a.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Rules 1-2 on raw, not-yet-verified events. Works per listing ADDRESS: the
 * address's newest revision decides (a newer sold / malformed revision must
 * still win, so older revisions are never judged on their own), and a kept
 * address keeps every revision for the verifier to fall back through.
 * Carried addresses bypass these filters so authenticated withdrawals can
 * remove the previous snapshot. Deletions pass through untouched.
 */
export async function curateOpenListingEvents(
  events: readonly Event[],
  opts: { maybeYield?: () => Promise<void>; now?: number; carried?: readonly Event[] } = {},
): Promise<Event[]> {
  // Carried addresses are bounded by the displayed snapshot. Their revisions
  // must reach authentication even when hygiene or the seller cap excludes them.
  const carried = new Set(
    (opts.carried ?? []).map((e) => `${e.kind}:${e.pubkey}:${tagValue(e, 'd')}`),
  );
  const retained: Event[] = [];
  const deletions: Event[] = [];
  const revisions = new Map<string, Event[]>();
  for (const event of events) {
    if (event.kind === 5) {
      deletions.push(event);
      continue;
    }
    const d = tagValue(event, 'd');
    if (!d) continue;
    const address = `${event.kind}:${event.pubkey}:${d}`;
    const list = revisions.get(address);
    if (list) list.push(event);
    else revisions.set(address, [event]);
  }
  const byAuthor = new Map<string, { newest: Event; list: Event[] }[]>();
  for (const [address, list] of revisions) {
    await opts.maybeYield?.();
    list.sort(newerFirst);
    if (carried.has(address)) {
      retained.push(...list);
      continue;
    }
    const product = parseMarketListing(list[0], opts.now);
    if (!product || !passesOpenScopeHygiene(product)) continue;
    const entry = { newest: list[0], list };
    const authored = byAuthor.get(list[0].pubkey);
    if (authored) authored.push(entry);
    else byAuthor.set(list[0].pubkey, [entry]);
  }
  const kept: Event[] = [];
  for (const entries of byAuthor.values()) {
    entries.sort((a, b) => newerFirst(a.newest, b.newest));
    for (const entry of entries.slice(0, OPEN_SCOPE_PER_AUTHOR)) kept.push(...entry.list);
  }
  return [...kept, ...retained, ...deletions];
}

/** Rules 1-2 on final products (newest first, as the reducer returns them). */
export function curateOpenListingProducts(products: readonly MarketProduct[]): MarketProduct[] {
  const perAuthor = new Map<string, number>();
  return products.filter((product) => {
    if (!passesOpenScopeHygiene(product)) return false;
    const author = product.listing?.event.pubkey ?? product.sellerName;
    const count = perAuthor.get(author) ?? 0;
    if (count >= OPEN_SCOPE_PER_AUTHOR) return false;
    perAuthor.set(author, count + 1);
    return true;
  });
}

/** Rule 3: keep only listings whose seller has a resolved kind-0 profile. */
export function withKnownProfiles<T extends MarketProduct>(
  products: readonly T[],
  hasProfile: (pubkey: string) => boolean,
): T[] {
  return products.filter((p) => !p.listing || hasProfile(p.listing.event.pubkey));
}
