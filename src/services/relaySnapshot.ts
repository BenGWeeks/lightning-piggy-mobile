import type { Event, Filter } from 'nostr-tools';
import { pool } from './nostrPool';

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
  signal: AbortSignal;
  /** Absolute epoch-ms deadline shared across chained snapshots. */
  deadline: number;
  /** How long the remaining relays get after the first full answer. */
  graceMs: number;
  /** Called with each event that passed the relay layer (dedup via `alreadyHave`). */
  onEvent: (event: Event) => void;
  /**
   * Skip events we already hold. The relay checks this BEFORE parsing and
   * verifying, so duplicates from other relays cost nothing.
   */
  alreadyHave?: (id: string) => boolean;
}

export interface RelaySnapshotResult {
  /** Relays that sent EOSE for every filter before the snapshot ended. */
  answered: string[];
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
  const { urls, filters, signal, deadline, graceMs, onEvent, alreadyHave } = opts;
  const remaining = deadline - Date.now();
  if (signal.aborted || remaining <= 0 || urls.length === 0) {
    return Promise.resolve({ answered: [], truncated: false, truncatedSince: null });
  }
  if (filters.length === 0) {
    return Promise.resolve({ answered: [...urls], truncated: false, truncatedSince: null });
  }

  return new Promise((resolve) => {
    let finished = false;
    let truncated = false;
    // Per cut-off subscription, the oldest created_at it delivered to us.
    const truncatedOldest: (() => number)[] = [];
    let settledRelays = 0;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const answered: string[] = [];
    const subscriptions: { close: () => void }[] = [];

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(deadlineTimer);
      if (graceTimer) clearTimeout(graceTimer);
      signal.removeEventListener('abort', finish);
      subscriptions.forEach((s) => s.close());
      const floors = truncatedOldest.map((oldest) => oldest());
      resolve({ answered, truncated, truncatedSince: floors.length ? Math.max(...floors) : null });
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
      pool
        .ensureRelay(url, { connectionTimeout: remaining })
        .then((relay) => {
          if (finished) return;
          let pendingFilters = filters.length;
          let failed = false;
          for (const filter of filters) {
            let received = 0;
            let oldest = Infinity;
            let flagged = false;
            let done = false;
            const filterDone = (ok: boolean) => {
              if (done) return;
              done = true;
              if (!ok) failed = true;
              if (--pendingFilters === 0) relaySettled(url, !failed);
            };
            const sub = relay.subscribe([filter], {
              // Keep the relay's own EOSE timeout past our deadline so a
              // timeout can never masquerade as a real EOSE.
              eoseTimeout: remaining * 2,
              alreadyHaveEvent: alreadyHave,
              receivedEvent: () => {
                // Count everything the relay sends, duplicates included: the
                // relay's `limit` counts them too, so counting after dedup
                // would make a cut-off reply look complete.
                if (filter.limit !== undefined && ++received >= filter.limit && !flagged) {
                  flagged = true;
                  truncated = true;
                  // Duplicates skipped via `alreadyHave` don't update `oldest`,
                  // so this can only read NEWER than the true floor — the safe
                  // direction (callers then treat the cut as mattering).
                  truncatedOldest.push(() => (Number.isFinite(oldest) ? oldest : Infinity));
                }
              },
              onevent: (event) => {
                if (event.created_at < oldest) oldest = event.created_at;
                if (!finished) onEvent(event);
              },
              oneose: () => filterDone(true),
              onclose: () => filterDone(false),
            });
            subscriptions.push(sub);
          }
        })
        .catch(() => relaySettled(url, false));
    }
  });
}
