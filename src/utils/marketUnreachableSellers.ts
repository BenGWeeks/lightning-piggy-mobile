import type { MarketProduct } from '../data/marketProducts';

/** Listing transport outcomes only: work/display/deletion caps cannot imply a missing seller. */
export function unreachableMarketSellers(
  scope: ReadonlySet<string>,
  queried: readonly string[],
  answered: readonly string[],
  receivedAuthors: ReadonlySet<string>,
  previous: readonly MarketProduct[],
  merged: readonly MarketProduct[],
): string[] {
  const shown = new Set(merged.map((product) => product.listing?.event.pubkey));
  const completed = new Set(answered);
  const sources = new Map<string, Set<string>>();
  for (const product of previous) {
    if (!product.listing) continue;
    const { event, seenOn } = product.listing;
    const urls = sources.get(event.pubkey) ?? new Set<string>();
    for (const url of seenOn ?? []) urls.add(url);
    sources.set(event.pubkey, urls);
  }
  return [...scope].filter((author) => {
    // Receiving a listing but withholding it for internal reasons is not an
    // unreachable seller. A cached product still on screen needs no warning.
    if (shown.has(author) || receivedAuthors.has(author)) return false;
    const known = sources.get(author);
    const relays = known?.size ? [...known] : queried;
    return relays.some((url) => queried.includes(url) && !completed.has(url));
  });
}
