import { verifyEvent, type Event, type Filter } from 'nostr-tools';
import { pool, trackRelays } from './nostrPool';
import { querySyncAbortable } from './relayQuery';
import { reduceMarketListings } from '../utils/marketListings';
import { addressRefs, deletionFilters, idRefs } from '../utils/nip09';
import { hasValidSignature } from '../utils/eventSignature';
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
    // Verified-but-oversized events are never rendered, yet still take part in
    // revision ordering and deletion. Keep small, non-renderable stand-ins
    // (sharing the event budget) instead of the payloads.
    const suppressions = new Map<string, Event>();
    // Signature checks hash the whole payload; beyond this we can't afford to
    // verify, so the snapshot is only flagged incomplete.
    const MAX_VERIFY_CHARS = 1048576;
    const verified = (event: Event) => {
      try {
        return verifyEvent(event);
      } catch {
        return false;
      }
    };
    // A bulk deletion over the tag limit still withdraws listings: keep a
    // trimmed copy with only the e / own-listing a tags.
    const suppressOversizedDeletion = (event: Event) => {
      if (suppressions.has(event.id) || events.size + suppressions.size >= MAX_EVENTS) return;
      const tags = event.tags
        .filter(
          (t) =>
            (t[0] === 'e' && /^[0-9a-f]{64}$/.test(t[1] ?? '')) ||
            (t[0] === 'a' &&
              /^(30018|30402):/.test(t[1] ?? '') &&
              t[1]?.split(':')[1] === event.pubkey),
        )
        .slice(0, MAX_EVENTS)
        .map((t) => [t[0], t[1]]);
      if (tags.length === 0 || !verified(event)) return;
      suppressions.set(event.id, { ...event, content: '', tags });
    };
    const suppressOversized = (event: Event) => {
      limited = true;
      if (event.content.length > MAX_VERIFY_CHARS) return;
      if (event.kind === 5) {
        suppressOversizedDeletion(event);
        return;
      }
      if (![30018, 30402].includes(event.kind)) return;
      const d = event.tags.find((t) => t[0] === 'd')?.[1];
      // Over-long ids are rejected as listings anyway, so there's nothing to hide.
      if (!d || new TextEncoder().encode(d).length > 255) return;
      const address = `${event.kind}:${event.pubkey}:${d}`;
      // Keep only the revision that would win this address (newest, then
      // lowest id — the reducer's own order), so a noisy relay can't grow this.
      const existing = suppressions.get(address);
      if (
        existing &&
        (existing.created_at > event.created_at ||
          (existing.created_at === event.created_at && existing.id <= event.id))
      )
        return;
      if (!existing && events.size + suppressions.size >= MAX_EVENTS) return;
      if (!verified(event)) return;
      // Same id/kind/created_at as the real revision so it competes normally;
      // empty content + a non-active status make it non-renderable.
      suppressions.set(address, {
        ...event,
        content: '',
        tags: [
          ['d', d],
          ['status', 'oversized'],
        ],
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
                if (events.size + suppressions.size >= MAX_EVENTS) {
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

/**
 * Re-fetch ONE listing (pull-to-refresh on its product page, #1301): the
 * newest revision of `current`'s address plus its author's kind-5s, reduced
 * by the same rules as the feed. Resolves null when the listing is gone
 * (deleted, sold, expired) and rejects only when every relay failed.
 *
 * Every fetched event's signature is checked here rather than trusting the
 * pool's verifier: a forged "newer revision" (another price or shop URL) or
 * a forged deletion must never reach the page. Events the pool already
 * verified are memoised by nostr-tools, so this costs nothing extra then.
 */
export async function fetchListingRevision(
  current: Event,
  relays: string[],
  signal: AbortSignal,
  maxWait = 3000,
): Promise<MarketProduct | null> {
  const d = current.tags.find((t) => t[0] === 'd')?.[1];
  if (!d || relays.length === 0) return null;
  trackRelays(relays);
  const opts = { maxWait, signal };
  const revisions = await querySyncAbortable(
    pool,
    relays,
    { kinds: [current.kind], authors: [current.pubkey], '#d': [d], limit: 10 },
    { ...opts, rejectOnAllRelaysFailure: true },
  );
  // `#d` / `authors` are only relay-side requests — keep signed revisions of
  // THIS address only (reduceMarketListings re-checks the author too).
  const sameAddress = revisions.filter(
    (e) =>
      e.kind === current.kind &&
      e.pubkey === current.pubkey &&
      e.tags.find((t) => t[0] === 'd')?.[1] === d &&
      hasValidSignature(e),
  );
  // Then the seller's kind-5s naming the address or ANY of the revisions
  // (one deleted by `e` id only must still withdraw). Best-effort, like the
  // feed: a failed lookup just applies no deletion.
  const known = [current, ...sameAddress];
  const deletions = await Promise.all(
    [...deletionFilters('a', addressRefs([current])), ...deletionFilters('e', idRefs(known))].map(
      (filter) => querySyncAbortable(pool, relays, filter, opts),
    ),
  ).then(
    (batches) => batches.flat(),
    () => [] as Event[],
  );
  const [product] = reduceMarketListings(
    [current, ...sameAddress, ...deletions.filter(hasValidSignature)],
    new Set([current.pubkey]),
  );
  return product ?? null;
}
