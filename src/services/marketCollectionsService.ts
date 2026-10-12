import type { Event } from 'nostr-tools';
import type { MarketProduct } from '../data/marketProducts';
import { queryQuorum, verifiedOwnEvents } from './marketSellerService';
import { marketSnapshotRelays } from '../utils/marketListingsQuery';
import { reduceSellerSnapshot } from '../utils/marketSellerSnapshot';

const DISCOVERY_TIMEOUT_MS = 20_000;
const DISCOVERY_CONCURRENCY = 4;

export interface CollectionDiscovery {
  events: Event[];
  incomplete: boolean;
}

/** One deadline covers discovery and deletion verification. Only batches whose
 * deletion checks finished are retained when other batches time out. */
export async function fetchMarketCollections(
  products: readonly MarketProduct[],
  relays: string[],
  signal?: AbortSignal,
): Promise<CollectionDiscovery> {
  if (signal?.aborted) return { events: [], incomplete: true };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  const completed: Event[] = [];
  const stop = new Promise<CollectionDiscovery>((resolve) => {
    onAbort = () => {
      resolve({ events: [], incomplete: true });
      controller.abort();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      resolve({ events: [...completed], incomplete: true });
      controller.abort();
    }, DISCOVERY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      discoverCollections(products, relays, completed, controller.signal),
      stop,
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    controller.abort();
  }
}

/** Replaceable collections need their latest revision regardless of age, so
 * no since window. Author batches, event caps and targeted deletions bound I/O. */
async function discoverCollections(
  products: readonly MarketProduct[],
  relays: string[],
  completed: Event[],
  signal: AbortSignal,
): Promise<CollectionDiscovery> {
  const authors = [
    ...new Set(products.flatMap((p) => (p.listing ? [p.listing.event.pubkey] : []))),
  ].slice(0, 128);
  const targets = marketSnapshotRelays(relays).urls;
  const references = [
    ...new Set(
      products.flatMap((p) =>
        (p.listing?.event.tags ?? [])
          .filter((t) => t[0] === 'a' && /^30405:[0-9a-f]{64}:.+$/.test(t[1] ?? ''))
          .map((t) => t[1]),
      ),
    ),
  ].slice(0, 128);
  const groups = authors.reduce<string[][]>((out, author, i) => {
    if (i % 32 === 0) out.push([]);
    out[out.length - 1].push(author);
    return out;
  }, []);
  const jobs: (() => Promise<Event[]>)[] = groups.map((batch) => async () => {
    const events = await queryQuorum(
      targets,
      { kinds: [30405], authors: batch, limit: 100 },
      signal,
    );
    const verified: Event[] = [];
    for (const pubkey of batch) {
      if (signal?.aborted) return [];
      verified.push(...(await verifiedOwnEvents(events, pubkey, [30405], signal)));
    }
    return verified;
  });
  // Author queries already cover their coordinates. Group only cross-author
  // (or capped-out author) references, keeping exact d filters bounded.
  const exact = new Map<string, string[]>();
  for (const reference of references) {
    const [, author, ...identifier] = reference.split(':');
    if (authors.includes(author)) continue;
    const identifiers = exact.get(author) ?? [];
    identifiers.push(identifier.join(':'));
    exact.set(author, identifiers);
  }
  for (const [author, identifiers] of exact) {
    for (let offset = 0; offset < identifiers.length; offset += 32) {
      const dTags = identifiers.slice(offset, offset + 32);
      jobs.push(async () => {
        const events = await queryQuorum(
          targets,
          { kinds: [30405], authors: [author], '#d': dTags, limit: dTags.length * 5 },
          signal,
        );
        return (await verifiedOwnEvents(events, author, [30405], signal)).filter((e) =>
          e.tags.some((t) => t[0] === 'd' && dTags.includes(t[1])),
        );
      });
    }
  }
  // Each worker finishes deletion checks before taking another discovery job,
  // so a slow batch cannot hold up safe results from other authors.
  let next = 0;
  let incomplete = false;
  await Promise.all(
    Array.from({ length: Math.min(DISCOVERY_CONCURRENCY, jobs.length) }, async () => {
      while (next < jobs.length && !signal.aborted) {
        const index = next++;
        try {
          const own = await jobs[index]();
          const safe = await checkCollectionDeletions(own, targets, signal);
          if (!signal.aborted) completed.push(...safe);
        } catch {
          incomplete = true;
        }
      }
    }),
  );
  return { events: completed, incomplete: incomplete || signal.aborted };
}

async function checkCollectionDeletions(
  own: Event[],
  targets: string[],
  signal: AbortSignal,
): Promise<Event[]> {
  const collections: Event[] = [];
  const allAuthors = [...new Set(own.map((e) => e.pubkey))];
  for (let i = 0; i < allAuthors.length; i += 32) {
    const batch = allAuthors.slice(i, i + 32);
    const events = own.filter((e) => batch.includes(e.pubkey));
    const addresses = [
      ...new Set(
        events.map((e) => `30405:${e.pubkey}:${e.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`),
      ),
    ];
    const ids = [...new Set(events.map((e) => e.id))];
    const deletes: Event[] = [];
    for (let offset = 0; offset < Math.max(addresses.length, ids.length); offset += 100) {
      if (signal?.aborted) return [];
      const addressBatch = addresses.slice(offset, offset + 100);
      const idBatch = ids.slice(offset, offset + 100);
      deletes.push(
        ...(
          await Promise.all([
            addressBatch.length
              ? queryQuorum(
                  targets,
                  {
                    kinds: [5],
                    authors: batch,
                    '#a': addressBatch,
                    limit: 200,
                  },
                  signal,
                )
              : Promise.resolve([]),
            idBatch.length
              ? queryQuorum(
                  targets,
                  { kinds: [5], authors: batch, '#e': idBatch, limit: 200 },
                  signal,
                )
              : Promise.resolve([]),
          ])
        ).flat(),
      );
    }
    for (const pubkey of batch) {
      const deletions = await verifiedOwnEvents(deletes, pubkey, [5], signal);
      collections.push(...(reduceSellerSnapshot([...own, ...deletions], pubkey).collections ?? []));
    }
  }
  return collections;
}
