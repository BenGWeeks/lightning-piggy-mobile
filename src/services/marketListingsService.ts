import type { Event } from 'nostr-tools';
import { pool, trackRelays } from './nostrPool';
import { querySyncAbortable } from './relayQuery';
import { collectRelaySnapshot } from './relaySnapshot';
import { verifyEventCached } from './nostrVerifyCache';
import { nostrGetEventHash } from './nostrCrypto';
import { createYieldScheduler } from '../contexts/nostrDecryptPacing';
import { reduceMarketListings, selectVerifiedListings } from '../utils/marketListings';
import {
  deletionFilters as listingDeletionFilters,
  listingFilters,
  marketSnapshotRelays,
} from '../utils/marketListingsQuery';
import { addressRefs, deletionFilters, idRefs } from '../utils/nip09';
import { hasValidSignature } from '../utils/eventSignature';
import { startJsStallProbe } from '../utils/jsStallProbe';
import { PERF_LOGS_ENABLED } from '../utils/perfLog';
import type { MarketProduct } from '../data/marketProducts';

export interface MarketListingsResult {
  products: MarketProduct[];
  incomplete: boolean;
}

const MAX_AUTHORS = 1024;
const MAX_EVENTS = 1200;
const MAX_PRODUCTS = 250;
/** Listings painted before the rest are verified — about two screens of grid. */
const FIRST_PAGE = 12;
/** Hard ceiling for both passes together. */
const TIMEOUT_MS = 10000;
/** Time other relays get once the first one has answered in full. */
const GRACE_MS = 2000;
// Signature checks hash the whole payload; beyond this we can't afford to
// verify, so the snapshot is only flagged incomplete.
const MAX_VERIFY_CHARS = 1048576;

/**
 * A listing batch that hit its `limit` only left out listings OLDER than
 * `truncatedSince`. When the display is already full (capped at the newest
 * MAX_PRODUCTS) with listings no older than that, nothing missing could have
 * made the cut — so a prolific seller filling one batch doesn't brand the
 * whole snapshot "could not be loaded".
 */
export function listingsCutMattered(
  truncatedSince: number | null,
  products: readonly MarketProduct[],
  capped: boolean,
): boolean {
  if (truncatedSince === null) return false;
  if (!capped || products.length < MAX_PRODUCTS) return true;
  const shownUntil = products[MAX_PRODUCTS - 1].listing?.event.created_at ?? -Infinity;
  return shownUntil < truncatedSince;
}

/**
 * Foreground snapshot of followed sellers' listings, bounded and abortable.
 *
 * Pass 1 fetches listings only; pass 2 fetches just the deletions that target
 * them (see `utils/marketListingsQuery`). Either pass completes once one relay
 * has answered in full plus a short grace, so a dead relay can't hold the
 * screen on "Loading…" until the deadline.
 */
export async function fetchMarketListings(
  authors: readonly string[],
  relays: readonly string[],
  signal: AbortSignal,
  /** Called at most once with the newest verified listings, before the rest. */
  onFirstPage?: (products: MarketProduct[]) => void,
): Promise<MarketListingsResult> {
  const keys = [...new Set(authors.filter((a) => /^[a-f0-9]{64}$/.test(a)))].sort();
  const scope = new Set(keys.slice(0, MAX_AUTHORS));
  if (signal.aborted || scope.size === 0) return { products: [], incomplete: false };
  const { urls, dropped } = marketSnapshotRelays(relays);
  if (urls.length === 0) return { products: [], incomplete: true };
  trackRelays(urls);

  const startedAt = Date.now();
  const probe = PERF_LOGS_ENABLED ? startJsStallProbe() : null;
  const deadline = startedAt + TIMEOUT_MS;
  let limited = keys.length > MAX_AUTHORS || dropped;
  let received = 0;
  const events = new Map<string, Event>();
  // Verified-but-oversized events are never rendered, yet still take part in
  // revision ordering and deletion. Keep small, non-renderable stand-ins
  // (sharing the event budget) instead of the payloads.
  const suppressions = new Map<string, Event>();
  // Signatures: the pool only structure-checks listing kinds (see
  // SKIP_VERIFY_KINDS in nostrService); listings are verified lazily below,
  // winners only. Deletions and oversized stand-ins are few and checked as
  // they arrive. `verifyEventCached` skips the schnorr for ids already
  // checked this session, so a refetch doesn't pay for the snapshot again.
  const verified = verifyEventCached;
  const idMatches = (event: Event) => {
    try {
      return nostrGetEventHash(event) === event.id;
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
  const ingest = (event: Event) => {
    received++;
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
    // Listings are verified later (winners only), but must hash to their id
    // NOW: `alreadyHave` dedupes by id, so a forged payload carrying a real
    // listing's id would otherwise squat it and get the genuine copy skipped.
    const ok = event.kind === 5 ? verified(event) : idMatches(event);
    if (ok) events.set(event.id, event);
  };
  const alreadyHave = (id: string) => events.has(id);

  const listings = await collectRelaySnapshot({
    urls,
    filters: listingFilters([...scope]),
    signal,
    deadline,
    graceMs: GRACE_MS,
    onEvent: ingest,
    alreadyHave,
  });
  const listingsDoneAt = Date.now();
  const candidates = [...events.values(), ...suppressions.values()].filter((e) => e.kind !== 5);
  // Ask the relays that answered pass 1 — they hold these listings, so they
  // are the ones likely to hold the deletions too.
  const deletions =
    candidates.length === 0 || signal.aborted
      ? { answered: urls, truncated: false, truncatedSince: null }
      : await collectRelaySnapshot({
          urls: listings.answered.length > 0 ? listings.answered : urls,
          filters: listingDeletionFilters(candidates),
          signal,
          deadline,
          graceMs: GRACE_MS,
          onEvent: ingest,
          alreadyHave,
        });

  let firstPageAt = 0;
  // Budget-gated yields keep taps responsive while winners are verified.
  const scheduler = createYieldScheduler({ signal, safetyEvery: 32 });
  const selection = await selectVerifiedListings(
    signal.aborted ? [] : [...events.values()],
    scope,
    {
      // Once aborted, fail fast instead of verifying the rest for nothing.
      verify: (event) => !signal.aborted && verified(event),
      maybeYield: scheduler.maybeYield,
      cap: MAX_PRODUCTS,
      firstPage: onFirstPage && {
        size: FIRST_PAGE,
        ready: (picked) => {
          if (signal.aborted) return;
          firstPageAt = Date.now();
          onFirstPage(reduceMarketListings([...picked, ...suppressions.values()], scope));
        },
      },
    },
  );
  scheduler.dispose();
  const products = signal.aborted
    ? []
    : reduceMarketListings([...selection.events, ...suppressions.values()], scope);
  const result = {
    products: products.slice(0, MAX_PRODUCTS),
    // Transport problems only. Reaching MAX_PRODUCTS is a deliberate display
    // cap (newest first), not a failed load — "could not be loaded, try
    // refreshing" would be untrue, and refreshing can't change it.
    incomplete:
      signal.aborted ||
      limited ||
      listingsCutMattered(listings.truncatedSince, products, selection.overflow) ||
      deletions.truncated ||
      listings.answered.length === 0 ||
      deletions.answered.length === 0,
  };
  if (probe) {
    const stall = probe.stop();
    console.log(
      `[PerfBlock] marketListings total=${Date.now() - startedAt}ms listings=${listingsDoneAt - startedAt}ms ` +
        `firstPage=${firstPageAt ? `${firstPageAt - startedAt}ms` : '-'} capped=${selection.overflow} ` +
        `truncated=${listings.truncated || deletions.truncated} cutMattered=${listingsCutMattered(listings.truncatedSince, products, selection.overflow)} limited=${limited} ` +
        `received=${received} kept=${events.size} verified=${selection.checked} products=${result.products.length} incomplete=${result.incomplete} ` +
        `authors=${scope.size} relays=${listings.answered.length}/${urls.length} ` +
        `jsMaxStall=${stall.maxMs}ms jsBlocked=${stall.blockedMs}ms`,
    );
  }
  return result;
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
