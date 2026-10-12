import type { Event } from 'nostr-tools';
import type { MarketProduct } from '../data/marketProducts';
import { queryQuorum, verifiedOwnEvents } from './marketSellerService';
import { marketSnapshotRelays } from '../utils/marketListingsQuery';
import { reduceSellerSnapshot } from '../utils/marketSellerSnapshot';

const DISCOVERY_TIMEOUT_MS = 20_000;
const DISCOVERY_CONCURRENCY = 4;

/** One deadline covers discovery, signature verification and deletion checks.
 * Incomplete deletion state must never expose a potentially deleted collection. */
export async function fetchMarketCollections(
  products: readonly MarketProduct[],
  relays: string[],
  signal?: AbortSignal,
): Promise<Event[]> {
  if (signal?.aborted) return [];
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  const stop = new Promise<Event[]>((resolve, reject) => {
    onAbort = () => {
      resolve([]);
      controller.abort();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      reject(new Error('Collection discovery timed out'));
      controller.abort();
    }, DISCOVERY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([discoverCollections(products, relays, controller.signal), stop]);
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
  signal?: AbortSignal,
): Promise<Event[]> {
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
  // Query exact coordinates: cross-author references are not limited to listing authors.
  for (const reference of references) {
    jobs.push(async () => {
      const [, author, ...identifier] = reference.split(':');
      const dTag = identifier.join(':');
      const events = await queryQuorum(
        targets,
        { kinds: [30405], authors: [author], '#d': [dTag], limit: 5 },
        signal,
      );
      return (await verifiedOwnEvents(events, author, [30405], signal)).filter((e) =>
        e.tags.some((t) => t[0] === 'd' && t[1] === dTag),
      );
    });
  }
  // Four workers share the queue; results retain query order regardless of relay latency.
  let next = 0;
  const results: Event[][] = new Array(jobs.length);
  await Promise.all(
    Array.from({ length: Math.min(DISCOVERY_CONCURRENCY, jobs.length) }, async () => {
      while (next < jobs.length && !signal?.aborted) {
        const index = next++;
        results[index] = await jobs[index]();
      }
    }),
  );
  if (signal?.aborted) return [];
  const own = results.flat();
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
