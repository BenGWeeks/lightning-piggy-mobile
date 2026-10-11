import type { Event } from 'nostr-tools';
import type { AbstractSimplePool } from 'nostr-tools/abstract-pool';
import { pool, trackRelays } from './nostrPool';
import { querySyncAbortable } from './relayQuery';
import { acquireMarketListingsPool } from './marketListingsPool';
import { selectHealthyRelays } from './relayHealth';
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
/** Deletions get their own budget so a full listing pass can't starve them. */
const MAX_DELETIONS = 600;
/**
 * Forged LISTING signatures tolerated per snapshot before giving up (and
 * flagging it incomplete). Every candidate already hashes to its id, so
 * failures mean a relay is serving fakes — it must not buy ~25 ms of
 * verification apiece.
 */
const MAX_FAILED_CHECKS = 64;
/**
 * Forged DELETION signatures tolerated before deletion checks stop. Past this
 * the remaining deletions are kept UNCHECKED and still applied (fail closed):
 * a hostile relay flooding fakes must not get a genuine withdrawal dropped
 * and a deleted listing shown as live. The snapshot is flagged incomplete.
 */
const MAX_FAILED_DELETION_CHECKS = 32;
/**
 * Forged oversized events tolerated before their (synchronous, in-callback)
 * checks stop. Oversized stand-ins can only HIDE a listing, never render one,
 * so past this they fail closed too, at no further cost.
 */
const MAX_FAILED_OVERSIZED_CHECKS = 16;
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
  const planned = marketSnapshotRelays(relays);
  // Leave out relays parked as dead (#1326): they'd only burn a connect
  // timeout each. The healthiest 2 are always kept.
  const urls = selectHealthyRelays(planned.urls);
  const dropped = planned.dropped;
  if (urls.length === 0) return { products: [], incomplete: true };
  // A dedicated structure-only pool: every event is verified here before use
  // (see marketListingsPool). Its sockets close when the last snapshot ends.
  const lease = acquireMarketListingsPool(urls);
  try {
    return await runSnapshot(
      scope,
      keys.length > MAX_AUTHORS || dropped,
      urls,
      lease.pool,
      signal,
      onFirstPage,
    );
  } finally {
    lease.release();
  }
}

async function runSnapshot(
  scope: ReadonlySet<string>,
  initiallyLimited: boolean,
  urls: string[],
  relayPool: Pick<AbstractSimplePool, 'ensureRelay'>,
  signal: AbortSignal,
  onFirstPage: ((products: MarketProduct[]) => void) | undefined,
): Promise<MarketListingsResult> {
  const startedAt = Date.now();
  const probe = PERF_LOGS_ENABLED ? startJsStallProbe() : null;
  const deadline = startedAt + TIMEOUT_MS;
  let limited = initiallyLimited;
  let received = 0;
  // Keyed by id AND signature: the id doesn't cover the signature, so a
  // bad-signature copy of a genuine payload must not displace the good copy.
  const events = new Map<string, Event>();
  let listingCount = 0;
  let deletionCount = 0;
  const budgetFull = (deletion: boolean) =>
    deletion ? deletionCount >= MAX_DELETIONS : listingCount >= MAX_EVENTS;
  // Oversized stand-ins were verified before their payload was stripped.
  const trusted = new WeakSet<Event>();
  // Verified-but-oversized events are never rendered, yet still take part in
  // revision ordering and deletion. Keep small, non-renderable stand-ins
  // (sharing their kind's budget) instead of the payloads.
  const suppressions = new Map<string, Event>();
  // Trust contract: this snapshot reads through its OWN structure-only pool
  // (marketListingsPool), so no event here has had its signature checked.
  // Listings are verified lazily below (winning revisions only); deletions in
  // a yielded loop before any can hide a listing; oversized events as they
  // arrive (rare, capped). The SHARED pool still fully verifies listing kinds
  // for every other reader — don't add them to its SKIP_VERIFY_KINDS.
  // `verifyEventCached` skips the schnorr for ids already checked this
  // session, so a refetch doesn't pay for the snapshot again.
  const verified = verifyEventCached;
  let oversizedFailures = 0;
  // Checks an oversized event inside the relay callback, but at most
  // MAX_FAILED_OVERSIZED_CHECKS forgeries' worth; then fails closed (see above).
  const checkOversized = (event: Event) => {
    if (oversizedFailures >= MAX_FAILED_OVERSIZED_CHECKS) return true;
    if (verified(event)) return true;
    oversizedFailures++;
    return false;
  };
  const idMatches = (event: Event) => {
    try {
      return nostrGetEventHash(event) === event.id;
    } catch {
      return false;
    }
  };
  // Ids and addresses of the listings pass 1 found. Deletions (pass 2) only
  // matter where they hit one of these.
  let knownTargets = new Set<string>();
  // The deletion's own targets among `knownTargets`: `e` ids, and `a`
  // addresses of the deletion author's OWN listings.
  const relevantTargets = (event: Event) =>
    event.tags
      .filter(
        (t) =>
          knownTargets.has(t[1] ?? '') &&
          (t[0] === 'e' || (t[0] === 'a' && t[1]?.split(':')[1] === event.pubkey)),
      )
      .map((t) => [t[0], t[1]] as [string, string]);
  // Fail closed for deletions we can't keep whole (budget full, or too large
  // to verify): remember just their targets among the listings found, newest
  // deletion time per target, and apply them unverified. Bounded by
  // `knownTargets`; author-scoped like any deletion. Flags the snapshot.
  const failClosedTargets = new Map<
    string,
    { pubkey: string; tag: [string, string]; at: number }
  >();
  const keepFailClosed = (event: Event) => {
    for (const tag of relevantTargets(event)) {
      const k = `${event.pubkey}|${tag[0]}|${tag[1]}`;
      const prev = failClosedTargets.get(k);
      if (!prev || prev.at < event.created_at) {
        failClosedTargets.set(k, { pubkey: event.pubkey, tag, at: event.created_at });
      }
    }
  };
  // A bulk deletion over the tag limit still withdraws listings: keep a
  // trimmed copy with only its targets among the listings found.
  const suppressOversizedDeletion = (event: Event) => {
    if (suppressions.has(event.id)) return;
    if (budgetFull(true)) {
      keepFailClosed(event);
      return;
    }
    const tags = relevantTargets(event);
    if (tags.length === 0 || !checkOversized(event)) return;
    const standIn = { ...event, content: '', tags };
    trusted.add(standIn);
    suppressions.set(event.id, standIn);
    deletionCount++;
  };
  const suppressOversized = (event: Event) => {
    limited = true;
    if (event.content.length > MAX_VERIFY_CHARS) {
      // Too large to verify: a deletion still fails closed on its targets.
      if (event.kind === 5) keepFailClosed(event);
      return;
    }
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
    if (!existing && budgetFull(false)) return;
    if (!checkOversized(event)) return;
    // Same id/kind/created_at as the real revision so it competes normally;
    // empty content + a non-active status make it non-renderable.
    const standIn = {
      ...event,
      content: '',
      tags: [
        ['d', d],
        ['status', 'oversized'],
      ],
    };
    trusted.add(standIn);
    suppressions.set(address, standIn);
    if (!existing) listingCount++;
  };
  const ingest = (event: Event) => {
    received++;
    if (!scope.has(event.pubkey) || event.created_at > Date.now() / 1000 + 300) return;
    if (event.content.length > 32768 || event.tags.length > 256) {
      suppressOversized(event);
      return;
    }
    const key = `${event.id}:${event.sig}`;
    if (events.has(key)) return;
    const deletion = event.kind === 5;
    if (budgetFull(deletion)) {
      limited = true;
      // A deletion that doesn't fit still withdraws what it targets.
      if (deletion) keepFailClosed(event);
      return;
    }
    // Listings are verified later (winners only); a payload that doesn't even
    // hash to its id is junk, so drop it now before it takes budget.
    if (!idMatches(event)) return;
    events.set(key, event);
    if (deletion) deletionCount++;
    else listingCount++;
  };

  const listings = await collectRelaySnapshot({
    urls,
    filters: listingFilters([...scope]),
    signal,
    deadline,
    graceMs: GRACE_MS,
    onEvent: ingest,
    relayPool,
  });
  const listingsDoneAt = Date.now();
  const candidates = [...events.values(), ...suppressions.values()].filter((e) => e.kind !== 5);
  knownTargets = new Set(
    candidates.flatMap((e) => {
      const d = e.tags.find((t) => t[0] === 'd')?.[1];
      return d ? [e.id, `${e.kind}:${e.pubkey}:${d}`] : [e.id];
    }),
  );
  // Ask every relay that responded in pass 1 (not just those that finished
  // in time — one that served listings may hold their deletions too). Relays
  // that never answered at all are left out, so they can't stall pass 2.
  const deletions =
    candidates.length === 0 || signal.aborted
      ? { answered: urls, responded: urls, truncated: false, truncatedSince: null }
      : await collectRelaySnapshot({
          urls: listings.responded.length > 0 ? listings.responded : urls,
          filters: listingDeletionFilters(candidates),
          signal,
          deadline,
          graceMs: GRACE_MS,
          onEvent: ingest,
          relayPool,
        });

  let firstPageAt = 0;
  // Budget-gated yields keep taps responsive while winners are verified.
  const scheduler = createYieldScheduler({ signal, safetyEvery: 32 });
  // Deletions arrive unverified (structure-only pool); check them here, with
  // yields, before any of them can hide a listing. A deletion that FAILS is
  // dropped; once too many have failed, the rest stay UNCHECKED and still
  // apply (fail closed) — dropping them would let a relay flooding forgeries
  // resurrect a listing its seller withdrew. A deletion can only hide its own
  // author's listings (the reducer checks), so this can't reach other sellers.
  let failedDeletionChecks = 0;
  for (const [key, event] of events) {
    if (event.kind !== 5) continue;
    if (signal.aborted) {
      events.delete(key);
      continue;
    }
    if (failedDeletionChecks >= MAX_FAILED_DELETION_CHECKS) continue;
    await scheduler.maybeYield();
    if (!verified(event)) {
      failedDeletionChecks++;
      events.delete(key);
    }
  }
  const deletionChecksGaveUp = failedDeletionChecks >= MAX_FAILED_DELETION_CHECKS;
  // Fail-closed targets become unverified, trusted stand-in deletions.
  const failClosedDeletions: Event[] = [...failClosedTargets.values()].map((t, i) => ({
    kind: 5,
    pubkey: t.pubkey,
    created_at: t.at,
    content: '',
    tags: [t.tag],
    id: `fail-closed-${i}`,
    sig: '',
  }));
  const selection = await selectVerifiedListings(
    signal.aborted ? [] : [...events.values(), ...suppressions.values(), ...failClosedDeletions],
    scope,
    {
      // Once aborted, fail fast instead of verifying the rest for nothing.
      verify: (event) => !signal.aborted && (trusted.has(event) || verified(event)),
      maybeYield: scheduler.maybeYield,
      cap: MAX_PRODUCTS,
      maxFailures: MAX_FAILED_CHECKS,
      firstPage: onFirstPage && {
        size: FIRST_PAGE,
        ready: (picked) => {
          if (signal.aborted) return;
          firstPageAt = Date.now();
          onFirstPage(reduceMarketListings(picked, scope));
        },
      },
    },
  );
  scheduler.dispose();
  const products = signal.aborted ? [] : reduceMarketListings(selection.events, scope);
  const result = {
    products: products.slice(0, MAX_PRODUCTS),
    // Transport problems only. Reaching MAX_PRODUCTS is a deliberate display
    // cap (newest first), not a failed load — "could not be loaded, try
    // refreshing" would be untrue, and refreshing can't change it.
    incomplete:
      signal.aborted ||
      limited ||
      deletionChecksGaveUp ||
      failClosedDeletions.length > 0 ||
      oversizedFailures >= MAX_FAILED_OVERSIZED_CHECKS ||
      selection.gaveUp ||
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
