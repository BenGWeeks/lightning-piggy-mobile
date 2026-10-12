import type { Event } from 'nostr-tools';
import type { MarketProduct } from '../data/marketProducts';
import { queryQuorum, verifiedOwnEvents } from './marketSellerService';
import { marketSnapshotRelays } from '../utils/marketListingsQuery';
import { reduceSellerSnapshot } from '../utils/marketSellerSnapshot';

/** Replaceable collections need their latest revision regardless of age, so
 * no since window. Author batches, event caps and targeted deletions bound I/O. */
export async function fetchMarketCollections(
  products: readonly MarketProduct[],
  relays: string[],
  signal?: AbortSignal,
): Promise<Event[]> {
  const authors = [
    ...new Set(products.flatMap((p) => (p.listing ? [p.listing.event.pubkey] : []))),
  ].slice(0, 128);
  const targets = marketSnapshotRelays(relays).urls;
  const collections: Event[] = [];
  for (let i = 0; i < authors.length; i += 32) {
    if (signal?.aborted) return [];
    const batch = authors.slice(i, i + 32);
    const events = await queryQuorum(
      targets,
      { kinds: [30405], authors: batch, limit: 100 },
      signal,
    );
    const own: Event[] = [];
    for (const pubkey of batch)
      own.push(...(await verifiedOwnEvents(events, pubkey, [30405], signal)));
    const addresses = [
      ...new Set(
        own.map((e) => `30405:${e.pubkey}:${e.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`),
      ),
    ].slice(0, 100);
    const ids = [...new Set(own.map((e) => e.id))].slice(0, 100);
    const deletes = addresses.length
      ? (
          await Promise.all([
            queryQuorum(
              targets,
              { kinds: [5], authors: batch, '#a': addresses, limit: 200 },
              signal,
            ),
            queryQuorum(targets, { kinds: [5], authors: batch, '#e': ids, limit: 200 }, signal),
          ])
        ).flat()
      : [];
    for (const pubkey of batch) {
      const deletions = await verifiedOwnEvents(deletes, pubkey, [5], signal);
      collections.push(...(reduceSellerSnapshot([...own, ...deletions], pubkey).collections ?? []));
    }
  }
  return collections;
}
