import { verifyEvent, type Event, type Filter } from 'nostr-tools';
import { pool, trackRelays } from './nostrPool';
import { reduceMarketListings } from '../utils/marketListings';
import type { MarketProduct } from '../data/marketProducts';

export interface MarketListingsResult {
  products: MarketProduct[];
  incomplete: boolean;
}

const MAX_AUTHORS = 1024;
const MAX_EVENTS = 1200;
const MAX_PRODUCTS = 250;
const TIMEOUT_MS = 12000;

/** Foreground snapshot, bounded and abortable, using the existing verified relay pool. */
export function fetchMarketListings(
  authors: readonly string[],
  relays: readonly string[],
  signal: AbortSignal,
): Promise<MarketListingsResult> {
  const keys = [...new Set(authors.filter((a) => /^[a-f0-9]{64}$/.test(a)))].sort();
  const scope = new Set(keys.slice(0, MAX_AUTHORS));
  const uniqueRelays = [...new Set(relays.filter((r) => /^wss:\/\//.test(r)))];
  const urls = uniqueRelays.slice(0, 6);
  if (signal.aborted || scope.size === 0)
    return Promise.resolve({ products: [], incomplete: false });
  if (urls.length === 0) return Promise.resolve({ products: [], incomplete: true });
  trackRelays(urls);
  return new Promise((resolve) => {
    let finished = false;
    let limited = keys.length > MAX_AUTHORS || uniqueRelays.length > urls.length;
    const events = new Map<string, Event>();
    // A verified-but-oversized revision is never rendered, yet it is still the
    // newest revision of its listing: record it as a deletion marker so the
    // reducer's newest-revision rule keeps older revisions hidden.
    const suppressions = new Map<string, Event>();
    const suppressOversized = (event: Event) => {
      limited = true;
      if (![30018, 30402].includes(event.kind) || event.content.length > 262144) return;
      const d = event.tags.find((t) => t[0] === 'd')?.[1];
      if (!d) return;
      try {
        if (!verifyEvent(event)) return;
      } catch {
        return;
      }
      suppressions.set(event.id, {
        ...event,
        id: `oversized-${event.id}`,
        kind: 5,
        content: '',
        tags: [['a', `${event.kind}:${event.pubkey}:${d}`]],
      });
    };
    const subscriptions: { close: () => void }[] = [];
    const complete = (incomplete: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      subscriptions.forEach((s) => s.close());
      const products = signal.aborted
        ? []
        : reduceMarketListings([...events.values(), ...suppressions.values()], scope);
      resolve({
        products: products.slice(0, MAX_PRODUCTS),
        incomplete: incomplete || limited || products.length > MAX_PRODUCTS,
      });
    };
    const abort = () => complete(true);
    const timer = setTimeout(() => complete(true), TIMEOUT_MS);
    signal.addEventListener('abort', abort, { once: true });
    const all = [...scope];
    const filters: Filter[] = [];
    for (let i = 0; i < all.length; i += 64) {
      filters.push({ kinds: [30018, 30402, 5], authors: all.slice(i, i + 64), limit: 100 });
    }
    // One subscription per relay × author batch. Only a real EOSE counts as a
    // loaded snapshot: a failed connection or an early CLOSED marks the result
    // incomplete, and the relay's own EOSE timeout is pushed past our deadline
    // so it can't masquerade as EOSE (the pool's aggregated `oneose` counts
    // closures and timeouts as EOSE).
    let pending = urls.length * filters.length;
    let failed = false;
    const settle = (ok: boolean) => {
      if (!ok) failed = true;
      if (!finished && --pending === 0) complete(failed);
    };
    for (const url of urls) {
      pool
        .ensureRelay(url, { connectionTimeout: TIMEOUT_MS })
        .then((relay) => {
          for (const filter of filters) {
            if (finished) return;
            let batchCount = 0;
            let done = false;
            const once = (ok: boolean) => {
              if (done) return;
              done = true;
              settle(ok);
            };
            const sub = relay.subscribe([filter], {
              eoseTimeout: TIMEOUT_MS * 2,
              onevent(event) {
                if (finished) return;
                // The relay's `limit` counts everything it sends, so count
                // before filtering/dedup or a truncated reply looks complete.
                if (++batchCount >= 100) limited = true;
                if (!scope.has(event.pubkey) || event.created_at > Date.now() / 1000 + 300) return;
                if (event.content.length > 32768 || event.tags.length > 256) {
                  suppressOversized(event);
                  return;
                }
                if (events.has(event.id)) return;
                if (events.size >= MAX_EVENTS) {
                  limited = true;
                  return;
                }
                try {
                  if (verifyEvent(event)) {
                    events.set(event.id, event);
                  }
                } catch {
                  /* Ignore malformed relay data. */
                }
              },
              oneose: () => once(true),
              onclose: () => once(false),
            });
            subscriptions.push(sub);
          }
        })
        .catch(() => {
          for (let i = 0; i < filters.length; i++) settle(false);
        });
    }
  });
}
