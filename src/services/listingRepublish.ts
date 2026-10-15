import { verifyEvent, type Event } from 'nostr-tools';
import { lockRelays } from '../config/testRelayLockdown';
import { MARKET_RELAYS } from '../utils/marketListingsQuery';
import { listingDTag, newestListing } from '../utils/listingRelayCoverage';
import { acquireMarketListingsPool } from './marketListingsPool';
import { querySyncAbortable } from './relayQuery';
import { PERF_LOGS_ENABLED } from '../utils/perfLog';
import { startJsStallProbe } from '../utils/jsStallProbe';
import { createYieldScheduler } from '../contexts/nostrDecryptPacing';

export function listingTargetRelays(
  pubkey: string,
  relays: readonly { url: string; write: boolean }[],
): string[] {
  const urls = [...relays.filter((r) => r.write).map((r) => r.url), ...MARKET_RELAYS]
    .map((url) => url.trim().replace(/\/+$/, '').toLowerCase())
    .filter((url) => /^wss?:\/\/[^/\s]+/.test(url));
  return [...new Set(lockRelays(urls, pubkey))];
}

export async function validListingCopies(
  events: readonly Event[],
  pubkey: string,
  signal?: AbortSignal,
): Promise<Event[]> {
  const scheduler = createYieldScheduler({ signal, safetyEvery: 10 });
  const valid: Event[] = [];
  const seen = new Set<string>();
  try {
    for (const event of events) {
      if (signal?.aborted) break;
      if (event.pubkey === pubkey && event.kind === 30402) {
        // Strip nostr-tools' cached verification symbol before verifying.
        const clean: Event = {
          id: event.id,
          sig: event.sig,
          pubkey: event.pubkey,
          kind: event.kind,
          created_at: event.created_at,
          tags: event.tags,
          content: event.content,
        };
        const serialized = JSON.stringify(clean);
        if (seen.has(serialized)) continue;
        seen.add(serialized);
        try {
          if (verifyEvent(clean)) valid.push(clean);
        } catch {
          /* malformed event */
        }
      }
      await scheduler.maybeYield();
    }
    return valid;
  } finally {
    scheduler.dispose();
  }
}

export interface ListingCoverageSnapshot {
  copies: Event[];
  relays: Map<string, Event[]>;
}

/** One bounded query per target relay; one coalesced snapshot for the UI. */
export async function fetchListingCoverage(
  pubkey: string,
  targets: string[],
  local: readonly Event[],
  signal: AbortSignal,
): Promise<ListingCoverageSnapshot> {
  targets = [...new Set(lockRelays(targets, pubkey))];
  const dTags = [...new Set(local.map(listingDTag))];
  if (!dTags.length || signal.aborted) return { copies: [], relays: new Map() };
  const lease = acquireMarketListingsPool(targets);
  const started = Date.now();
  const probe = PERF_LOGS_ENABLED ? startJsStallProbe() : null;
  try {
    const results = await Promise.all(
      targets.map(async (url): Promise<[string, Event[]]> => {
        try {
          const events = await querySyncAbortable(
            lease.pool,
            [url],
            {
              authors: [pubkey],
              kinds: [30402],
              '#d': dTags,
              limit: Math.min(1000, dTags.length * 5),
            },
            { maxWait: 8000, signal, rejectOnAllRelaysFailure: true, rejectOnTimeout: true },
          );
          return [url, events.filter((event) => dTags.includes(listingDTag(event)))];
        } catch {
          return [url, []];
        }
      }),
    );
    const relays = new Map<string, Event[]>();
    // Verify each id once, then reuse the clean copies across relay snapshots.
    const all = [...local, ...results.flatMap(([, events]) => events)];
    const valid = await validListingCopies(all, pubkey, signal);
    const byId = new Map(valid.map((event) => [event.id, event]));
    for (const [url, events] of results)
      relays.set(
        url,
        events.flatMap((event) => {
          const clean = byId.get(event.id);
          return clean &&
            clean.sig === event.sig &&
            clean.content === event.content &&
            clean.created_at === event.created_at &&
            clean.pubkey === event.pubkey &&
            clean.kind === event.kind &&
            JSON.stringify(clean.tags) === JSON.stringify(event.tags)
            ? [clean]
            : [];
        }),
      );
    return { copies: [...byId.values()], relays };
  } finally {
    lease.release();
    if (probe) {
      const stall = probe.stop();
      console.log(
        `[PerfBlock] listingCoverage relays=${targets.length} listings=${dTags.length} total=${Date.now() - started}ms jsMaxStall=${stall.maxMs}ms jsBlocked=${stall.blockedMs}ms`,
      );
    }
  }
}

export const newestSignedListing = (
  snapshot: ListingCoverageSnapshot,
  dTag: string,
): Event | null => newestListing(snapshot.copies.filter((event) => listingDTag(event) === dTag));

export interface ListingRepublishResult {
  url: string;
  status: 'accepted' | 'rejected' | 'noResponse' | 'alreadyPresent';
  reason?: string;
}

/** No signer dependency: only existing, verified signed events can reach publish. */
export async function republishListing(
  pubkey: string,
  dTag: string,
  snapshot: ListingCoverageSnapshot,
  signal: AbortSignal,
  timeoutMs = 8000,
): Promise<ListingRepublishResult[]> {
  const event = newestListing(
    await validListingCopies(
      snapshot.copies.filter((e) => listingDTag(e) === dTag),
      pubkey,
      signal,
    ),
  );
  if (!event) throw new Error('No signed listing copy');
  const targets = [...new Set(lockRelays([...snapshot.relays.keys()], pubkey))];
  const lease = acquireMarketListingsPool(targets);
  try {
    return await Promise.all(
      targets.map(async (url): Promise<ListingRepublishResult> => {
        if (snapshot.relays.get(url)?.some((copy) => copy.id === event.id))
          return { url, status: 'alreadyPresent' };
        if (signal.aborted) return { url, status: 'noResponse' };
        let timer: ReturnType<typeof setTimeout> | undefined;
        let onAbort: () => void = () => {};
        const deadline = new Promise<ListingRepublishResult>((resolve) => {
          onAbort = () => resolve({ url, status: 'noResponse' });
          signal.addEventListener('abort', onAbort, { once: true });
          timer = setTimeout(onAbort, timeoutMs);
        });
        try {
          const attempt = Promise.resolve()
            .then(() => lease.pool.publish([url], event)[0])
            .then(
              (reason): ListingRepublishResult =>
                reason === undefined ||
                /connection (failure|failed|timed out|closed)|timeout/i.test(reason)
                  ? { url, status: 'noResponse' }
                  : { url, status: 'accepted' },
              (error: unknown): ListingRepublishResult => {
                const reason = error instanceof Error ? error.message : String(error);
                return /^(?:(?:relay )?connection (?:failure|failed|closed|timed out)|publish timed out|websocket closed|timed out|timeout)/i.test(
                  reason,
                )
                  ? { url, status: 'noResponse' }
                  : { url, status: 'rejected', reason };
              },
            );
          return await Promise.race([attempt, deadline]);
        } finally {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
        }
      }),
    );
  } finally {
    lease.release();
  }
}
