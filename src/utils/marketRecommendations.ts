import type { MarketProduct } from '../data/marketProducts';
import type { MarketMode } from './marketMode';

/**
 * Pure data-shaping for the two carousels at the bottom of a Market product
 * page (#1542): "More from <seller>" and "You might like". Everything here
 * works on listings ALREADY loaded into the Market catalogue — no relay I/O.
 */

/** Cards per carousel. */
export const RECOMMENDATION_LIMIT = 12;
/** "You might like" is hidden below this many candidates — one lonely card
 * reads as a glitch, not a suggestion. */
export const MIN_RECOMMENDATIONS = 2;

/** One loaded Market snapshot and the Market mode it belongs to. */
export interface CatalogueSource {
  mode: MarketMode;
  products: readonly MarketProduct[];
}

/** De-duplicated, re-validated kind-30402 listings, newest first. */
export interface MarketCatalogue {
  products: MarketProduct[];
  /** Which Market mode each seller (hex pubkey) was loaded under — the mode
   * the "See all" grid must open in for its merchant filter to stick. The
   * preferred-sellers catalogue wins when a seller appears in both. */
  modeBySeller: Map<string, MarketMode>;
}

const tagValue = (product: MarketProduct, name: string) =>
  product.listing?.event.tags.find((t) => t[0] === name)?.[1];

/** `30402:<pubkey>:<d>` for a relay listing, else null (curated products). */
export function listingAddress(product: MarketProduct): string | null {
  const event = product.listing?.event;
  if (!event) return null;
  const d = tagValue(product, 'd');
  return d ? `${event.kind}:${event.pubkey}:${d}` : null;
}

/**
 * Whether a listing is still showable. Snapshots were reduced (deletions
 * applied, hidden / sold / expired dropped) when fetched, but a cached
 * snapshot ages — so expiry is rechecked, and status / visibility are
 * rechecked defensively in case a snapshot came from an older parser.
 */
function isActiveListing(product: MarketProduct, now: number): boolean {
  const event = product.listing?.event;
  if (!event || event.kind !== 30402) return false;
  const expiry = tagValue(product, 'expiration');
  if (expiry && (!Number.isFinite(Number(expiry)) || Number(expiry) <= now)) return false;
  const status = tagValue(product, 'status');
  if (status && status !== 'active') return false;
  return tagValue(product, 'visibility') !== 'hidden';
}

const newestFirst = (a: MarketProduct, b: MarketProduct) =>
  b.listing!.event.created_at - a.listing!.event.created_at || a.id.localeCompare(b.id);

/**
 * Merge every loaded snapshot into one catalogue. A listing present in more
 * than one snapshot (preferred + friends) keeps its newest revision.
 */
export function mergeCatalogue(
  sources: readonly CatalogueSource[],
  now = Date.now() / 1000,
): MarketCatalogue {
  const byAddress = new Map<string, MarketProduct>();
  const modeBySeller = new Map<string, MarketMode>();
  for (const source of sources) {
    for (const product of source.products) {
      if (product.listing?.event.kind !== 30402) continue;
      const address = listingAddress(product);
      if (!address) continue;
      const seller = product.listing!.event.pubkey;
      if (!modeBySeller.has(seller) || source.mode === 'preferred')
        modeBySeller.set(seller, source.mode);
      const previous = byAddress.get(address);
      if (
        !previous ||
        product.listing!.event.created_at > previous.listing!.event.created_at ||
        (product.listing!.event.created_at === previous.listing!.event.created_at &&
          product.listing!.event.id < previous.listing!.event.id)
      )
        byAddress.set(address, product);
    }
  }
  return {
    products: [...byAddress.values()]
      .filter((product) => isActiveListing(product, now))
      .sort(newestFirst),
    modeBySeller,
  };
}

/**
 * "More from <seller>": the seller's other active listings, newest first.
 * The current listing is excluded by address, so a refreshed revision of
 * the page's own listing never shows up as "another" product.
 */
export function sellerListings(
  products: readonly MarketProduct[],
  sellerPubkey: string | null,
  current: MarketProduct,
  limit = RECOMMENDATION_LIMIT,
  now = Date.now() / 1000,
): MarketProduct[] {
  if (!sellerPubkey) return [];
  const currentAddress = listingAddress(current);
  return products
    .filter(
      (p) =>
        p.listing?.event.pubkey === sellerPubkey &&
        p.id !== current.id &&
        listingAddress(p) !== currentAddress &&
        isActiveListing(p, now),
    )
    .sort(newestFirst)
    .slice(0, limit);
}

/** Signals beyond the listing itself that lift a candidate. */
export interface RecommendationSignals {
  /** Hex pubkeys the viewer follows (kind-3). */
  followed: ReadonlySet<string>;
  /** Listing addresses the viewer has liked (NIP-25 kind 7). Optional until
   * the likes helper lands (feat/market-like-share).
   * TODO(#1542): wire in the Market likes helper once it is on main. */
  liked?: ReadonlySet<string>;
  /** The signed-in viewer — their own listings are never recommended. */
  viewer?: string | null;
}

/** Why a candidate ranked where it did — compared field by field, in order. */
export interface RecommendationScore {
  sharedTags: number;
  sameCollection: boolean;
  liked: boolean;
  followedSeller: boolean;
  createdAt: number;
}

const categoryTags = (product: MarketProduct) =>
  new Set(
    (product.listing?.event.tags ?? [])
      .filter((t) => t[0] === 't' && typeof t[1] === 'string' && t[1].trim())
      .map((t) => t[1].trim().toLowerCase()),
  );

/** 30405 collection coordinates a listing declares itself part of. */
const collections = (product: MarketProduct) =>
  new Set(
    (product.listing?.event.tags ?? [])
      .filter((t) => t[0] === 'a' && typeof t[1] === 'string' && t[1].startsWith('30405:'))
      .map((t) => t[1]),
  );

export function scoreRecommendation(
  candidate: MarketProduct,
  current: MarketProduct,
  signals: RecommendationSignals,
): RecommendationScore {
  const currentTags = categoryTags(current);
  let sharedTags = 0;
  for (const tag of categoryTags(candidate)) if (currentTags.has(tag)) sharedTags++;
  const currentCollections = collections(current);
  const address = listingAddress(candidate);
  return {
    sharedTags,
    sameCollection: [...collections(candidate)].some((c) => currentCollections.has(c)),
    liked: !!address && !!signals.liked?.has(address),
    followedSeller: signals.followed.has(candidate.listing?.event.pubkey ?? ''),
    createdAt: candidate.listing?.event.created_at ?? 0,
  };
}

/** Strongest signal first: shared tags, then collection, liked, followed
 * seller, and finally recency. Negative = `a` ranks before `b`. */
export function compareScores(a: RecommendationScore, b: RecommendationScore): number {
  return (
    b.sharedTags - a.sharedTags ||
    Number(b.sameCollection) - Number(a.sameCollection) ||
    Number(b.liked) - Number(a.liked) ||
    Number(b.followedSeller) - Number(a.followedSeller) ||
    b.createdAt - a.createdAt
  );
}

/**
 * "You might like": ranked candidates from the loaded catalogue. Excludes
 * the current listing, anything already shown in the seller rail
 * (`alreadyShown`, by product id), and the viewer's own listings.
 */
export function recommendListings(
  products: readonly MarketProduct[],
  current: MarketProduct,
  alreadyShown: readonly MarketProduct[],
  signals: RecommendationSignals,
  limit = RECOMMENDATION_LIMIT,
  now = Date.now() / 1000,
): MarketProduct[] {
  const currentAddress = listingAddress(current);
  const shown = new Set(alreadyShown.map((p) => p.id));
  return products
    .filter(
      (p) =>
        p.id !== current.id &&
        !shown.has(p.id) &&
        listingAddress(p) !== currentAddress &&
        !(signals.viewer && p.listing?.event.pubkey === signals.viewer) &&
        isActiveListing(p, now),
    )
    .map((product) => ({ product, score: scoreRecommendation(product, current, signals) }))
    .sort((a, b) => compareScores(a.score, b.score) || a.product.id.localeCompare(b.product.id))
    .slice(0, limit)
    .map(({ product }) => product);
}

/** Hide the "You might like" section when it would be (nearly) empty. */
export function shouldShowRecommendations(items: readonly MarketProduct[]): boolean {
  return items.length >= MIN_RECOMMENDATIONS;
}

/** `product-reco-card-<id8>` suffix: the listing event id's first 8 hex
 * chars (the product id's first 8 for a listing-less product). */
export function recommendationCardId(product: MarketProduct): string {
  return (product.listing?.event.id ?? product.id).slice(0, 8);
}

/** Most product pages a chain of carousel taps may stack before each further
 * tap replaces the top page instead — Back still walks the recent trail, but
 * browsing "you might like" forever can't grow the stack without bound. */
export const MAX_PRODUCT_PAGE_CHAIN = 5;

/**
 * Push or replace when a carousel card opens another product page:
 * `push` until the stack's top already holds `max` consecutive product
 * pages, then `replace`. Either way the new page mounts fresh, at the top.
 */
export function productPageAction(
  routeNames: readonly string[],
  productRoute: string,
  max = MAX_PRODUCT_PAGE_CHAIN,
): 'push' | 'replace' {
  let depth = 0;
  for (let i = routeNames.length - 1; i >= 0 && routeNames[i] === productRoute; i--) depth++;
  return depth >= max ? 'replace' : 'push';
}
