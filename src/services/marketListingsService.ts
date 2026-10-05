import { verifyEvent, type Event } from 'nostr-tools';
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
    let pending = Math.ceil(scope.size / 64);
    let limited = keys.length > MAX_AUTHORS || uniqueRelays.length > urls.length;
    const events = new Map<string, Event>();
    const subscriptions: { close: () => void }[] = [];
    const complete = (incomplete: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      subscriptions.forEach((s) => s.close());
      const products = signal.aborted ? [] : reduceMarketListings([...events.values()], scope);
      resolve({
        products: products.slice(0, MAX_PRODUCTS),
        incomplete: incomplete || limited || products.length > MAX_PRODUCTS,
      });
    };
    const abort = () => complete(true);
    const timer = setTimeout(() => complete(true), TIMEOUT_MS);
    signal.addEventListener('abort', abort, { once: true });
    const all = [...scope];
    for (let i = 0; i < all.length && !finished; i += 64) {
      let batchCount = 0;
      try {
        const sub = pool.subscribeMany(
          urls,
          { kinds: [30018, 30402, 5], authors: all.slice(i, i + 64), limit: 100 },
          {
            onevent(event) {
              if (
                finished ||
                !scope.has(event.pubkey) ||
                event.content.length > 32768 ||
                event.tags.length > 256 ||
                event.created_at > Date.now() / 1000 + 300
              )
                return;
              if (events.has(event.id)) return;
              if (events.size >= MAX_EVENTS) {
                limited = true;
                return;
              }
              try {
                if (verifyEvent(event)) {
                  events.set(event.id, event);
                  if (++batchCount >= 100) limited = true;
                }
              } catch {
                /* Ignore malformed relay data. */
              }
            },
            oneose() {
              if (!finished && --pending === 0) complete(false);
            },
          },
        );
        if (finished) sub.close();
        else subscriptions.push(sub);
      } catch {
        limited = true;
        if (--pending === 0) complete(true);
      }
    }
  });
}
