import type { Event, Filter } from 'nostr-tools';
import type { AbstractSimplePool } from 'nostr-tools/abstract-pool';
import { subscribeRelayWithBudget } from './relayReqSubscription';
import { pool as sharedPool } from './nostrPool';

/**
 * One-shot "what do these relays hold right now" query: subscribe each relay
 * to every filter, stop at EOSE, and report which relays answered in full.
 *
 * Why not `pool.querySync`: its aggregated EOSE also counts closures and
 * timeouts, so a relay that failed looks the same as one that answered. Here
 * only a real EOSE for every filter counts as "answered".
 *
 * Latency: a slow or dead relay must not hold the snapshot open. Once the
 * first relay has answered everything, the others get `graceMs` to catch up.
 * After that the snapshot completes without them. Redundant relays usually
 * hold the same events, so waiting the full deadline for a dead one (often
 * ~10 s of connection timeout) only delays the result.
 */

export interface RelaySnapshotOptions {
  urls: readonly string[];
  filters: readonly Filter[];
  /** Maximum active filter subscriptions per relay. */
  maxConcurrentFilters?: number;
  signal: AbortSignal;
  /** Absolute epoch-ms deadline shared across chained snapshots. */
  deadline: number;
  /** How long the remaining relays get after the first full answer. */
  graceMs: number;
  /** Called with each event that passed the relay layer, and the relay it came from. */
  onEvent: (event: Event, url: string) => void;
  /** Pool to subscribe through (default: the shared, fully verifying pool). */
  relayPool?: Pick<AbstractSimplePool, 'ensureRelay'>;
}

export interface RelaySnapshotResult {
  /** Relays that sent EOSE for every filter before the snapshot ended. */
  answered: string[];
  /** Relays that sent anything (an event or an EOSE) — reachable, if slow. */
  responded: string[];
  /** Some relay returned as many events as a filter's `limit` (results cut off). */
  truncated: boolean;
  /**
   * For cut-off replies: the newest "oldest event delivered" across them.
   * Relays return newest first, so anything a truncated reply left out is
   * older than this — callers that only show the newest N can tell whether
   * the cut mattered. Null when nothing was truncated.
   */
  truncatedSince: number | null;
}

export function collectRelaySnapshot(opts: RelaySnapshotOptions): Promise<RelaySnapshotResult> {
  const { urls, filters, signal, deadline, graceMs, onEvent, relayPool = sharedPool } = opts;
  const concurrency = Math.max(1, Math.floor(opts.maxConcurrentFilters ?? filters.length));
  const remaining = deadline - Date.now();
  if (signal.aborted || remaining <= 0 || urls.length === 0) {
    return Promise.resolve({ answered: [], responded: [], truncated: false, truncatedSince: null });
  }
  if (filters.length === 0) {
    return Promise.resolve({
      answered: [...urls],
      responded: [...urls],
      truncated: false,
      truncatedSince: null,
    });
  }

  return new Promise((resolve) => {
    let finished = false;
    let truncated = false;
    // Per cut-off subscription, the oldest created_at it delivered to us.
    const truncatedOldest: (() => number)[] = [];
    let settledRelays = 0;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const answered: string[] = [];
    const heard = new Set<string>();
    const subscriptions = new Set<{ close: () => void }>();

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(deadlineTimer);
      if (graceTimer) clearTimeout(graceTimer);
      signal.removeEventListener('abort', finish);
      subscriptions.forEach((s) => s.close());
      const floors = truncatedOldest.map((oldest) => oldest());
      resolve({
        answered,
        responded: urls.filter((u) => heard.has(u)),
        truncated,
        truncatedSince: floors.length ? Math.max(...floors) : null,
      });
    };
    const deadlineTimer = setTimeout(finish, remaining);
    signal.addEventListener('abort', finish, { once: true });

    const relaySettled = (url: string, ok: boolean) => {
      if (finished) return;
      if (ok) {
        answered.push(url);
        if (answered.length === 1 && settledRelays + 1 < urls.length) {
          graceTimer = setTimeout(finish, graceMs);
        }
      }
      if (++settledRelays === urls.length) finish();
    };

    for (const url of urls) {
      relayPool
        .ensureRelay(url, { connectionTimeout: remaining })
        .then((relay) => {
          if (finished) return;
          let pendingFilters = filters.length;
          let failed = false;
          let nextFilter = 0;
          let active = 0;
          const pump = () => {
            while (!finished && active < concurrency && nextFilter < filters.length) {
              const filter = filters[nextFilter++];
              active++;
              let received = 0;
              let oldest = Infinity;
              let flagged = false;
              let done = false;
              const filterDone = (ok: boolean) => {
                if (done) return;
                done = true;
                if (!ok) failed = true;
                // Close answered subscriptions before opening the next chunk.
                // Defer so even synchronous callbacks have an assigned sub.
                void Promise.resolve().then(() => {
                  if (finished) return;
                  subscriptions.delete(sub);
                  sub.close();
                  active--;
                  if (--pendingFilters === 0) relaySettled(url, !failed);
                  else pump();
                });
              };
              const sub = subscribeRelayWithBudget(relayPool, relay, [filter], {
                // Keep the relay's own EOSE timeout past our deadline so a
                // timeout can never masquerade as a real EOSE.
                eoseTimeout: remaining * 2,
                receivedEvent: () => {
                  if (finished || done) return;
                  heard.add(url);
                  // Count everything the relay sends, duplicates included: the
                  // relay's `limit` counts them too, so counting after dedup
                  // would make a cut-off reply look complete.
                  if (filter.limit !== undefined && ++received >= filter.limit && !flagged) {
                    flagged = true;
                    truncated = true;
                    truncatedOldest.push(() => (Number.isFinite(oldest) ? oldest : Infinity));
                  }
                },
                onevent: (event) => {
                  if (event.created_at < oldest) oldest = event.created_at;
                  if (!finished && !done) onEvent(event, url);
                },
                oneose: () => {
                  heard.add(url);
                  filterDone(true);
                },
                onclose: () => filterDone(false),
              });
              subscriptions.add(sub);
            }
          };
          pump();
        })
        .catch(() => relaySettled(url, false));
    }
  });
}
