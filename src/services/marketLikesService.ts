import type { Event, Filter } from 'nostr-tools';
import { pool, trackRelays } from './nostrPool';
import { querySyncAbortable } from './relayQuery';
import { resolveEmbed } from './nostrEmbedCache';
import { marketSnapshotRelays } from '../utils/marketListingsQuery';
import {
  LIKES_QUERY_LIMIT,
  LISTING_KIND,
  aggregateListingLikes,
  chunkIds,
  deriveLikedListings,
  type ListingLikes,
} from '../utils/marketLikes';
import type { MarketProduct } from '../data/marketProducts';

// Relay reads for Market listing likes (#1541): one bounded fetch per screen
// focus, no live subscription. Everything goes through the shared pool, which
// verifies kind 7 / kind 5 signatures, so a forged like or retraction can't
// skew the count or the viewer's Liked items.

const TIMEOUT_MS = 5000;
/** Bound on the viewer's own reactions to one listing (normally 0 or 1). */
const OWN_REACTIONS_LIMIT = 50;

/** The user's read relays plus the Market relays listings (and likes) live on. */
export function likeReadRelays(readRelays: readonly string[]): string[] {
  return marketSnapshotRelays(readRelays).urls;
}

/** Retractions (kind 5) of the given reactions, chunked; best effort. */
async function fetchRetractions(
  reactions: readonly Event[],
  relays: string[],
  signal: AbortSignal,
  authors?: string[],
): Promise<Event[]> {
  const ids = reactions.map((r) => r.id);
  const batches = await Promise.all(
    chunkIds(ids).map((chunk) => {
      const filter: Filter = { kinds: [5], '#e': chunk, limit: chunk.length };
      if (authors) filter.authors = authors;
      return querySyncAbortable(pool, relays, filter, { maxWait: TIMEOUT_MS, signal }).catch(
        () => [] as Event[],
      );
    }),
  );
  return batches.flat();
}

/** Like count + the viewer's own active like for one listing coordinate. */
export async function fetchListingLikes(
  coordinate: string,
  viewer: string | null,
  readRelays: readonly string[],
  signal: AbortSignal,
): Promise<ListingLikes> {
  const relays = likeReadRelays(readRelays);
  trackRelays(relays);
  const [publicReactions, ownReactions] = await Promise.all([
    querySyncAbortable(
      pool,
      relays,
      { kinds: [7], '#a': [coordinate], limit: LIKES_QUERY_LIMIT },
      { maxWait: TIMEOUT_MS, signal, rejectOnAllRelaysFailure: true },
    ),
    // The viewer's own reactions, author-scoped: on a popular listing the
    // public query's limit can crowd them out, and Unlike must see every
    // active like of ours or it retracts only some of them.
    viewer
      ? querySyncAbortable(
          pool,
          relays,
          { kinds: [7], authors: [viewer], '#a': [coordinate], limit: OWN_REACTIONS_LIMIT },
          { maxWait: TIMEOUT_MS, signal, rejectOnAllRelaysFailure: true },
        )
      : Promise.resolve([] as Event[]),
  ]);
  const byId = new Map<string, Event>();
  for (const event of [...publicReactions, ...ownReactions]) byId.set(event.id, event);
  const reactions = [...byId.values()];
  const deletions = signal.aborted ? [] : await fetchRetractions(reactions, relays, signal);
  return aggregateListingLikes(reactions, deletions, coordinate, viewer);
}

/**
 * The viewer's liked listings, newest like first: their own kind-7s on
 * kind-30402 listings (`#k`), minus retracted ones, resolved to live
 * products through the batched, verified embed cache (which also applies
 * the seller's deletions). Gone / sold / expired listings are dropped.
 */
export async function fetchLikedListings(
  viewer: string,
  readRelays: readonly string[],
  signal: AbortSignal,
): Promise<MarketProduct[]> {
  const relays = likeReadRelays(readRelays);
  trackRelays(relays);
  const reactions = await querySyncAbortable(
    pool,
    relays,
    { kinds: [7], authors: [viewer], '#k': [String(LISTING_KIND)], limit: LIKES_QUERY_LIMIT },
    { maxWait: TIMEOUT_MS, signal, rejectOnAllRelaysFailure: true },
  );
  if (signal.aborted) return [];
  const deletions = await fetchRetractions(reactions, relays, signal, [viewer]);
  if (signal.aborted) return [];
  const liked = deriveLikedListings(reactions, deletions, viewer);
  const results = await Promise.all(
    liked.map((ref) =>
      resolveEmbed(
        {
          type: 'address',
          kind: ref.kind,
          pubkey: ref.pubkey,
          identifier: ref.identifier,
          relays: [],
          // Only the Unavailable card's web link reads `raw`; it isn't rendered here.
          raw: '',
        },
        relays,
      ),
    ),
  );
  const products: MarketProduct[] = [];
  for (const result of results) if (result.product) products.push(result.product);
  return products;
}
