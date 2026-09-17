import type { SimplePool } from 'nostr-tools/pool';
import type { Filter } from 'nostr-tools/filter';
import type { Event as NostrEvent } from 'nostr-tools/pure';

/**
 * Abortable variant of `pool.querySync`. nostr-tools' `querySync` collects
 * events until EOSE but its public *type* omits the `abort` param — even though
 * the implementation forwards it down to `subscribe`, which closes the sub on
 * abort (see nostr-tools pool.js). This typed wrapper exposes that: the promise
 * resolves with whatever has arrived when EOSE fires, the per-relay `maxWait`
 * elapses, OR `signal` aborts.
 *
 * That last case is the point — it lets a screen cancel an in-flight inbox
 * fetch on tab-blur/unmount instead of the JS thread chewing through the full
 * wrap backlog after the user has already navigated away (#751: the abort was
 * plumbed to refreshDmInbox but never reached the relay subscription, so
 * nav-away still waited the full fetch). The pool is passed in (rather than
 * imported) to keep this a leaf module with no dependency back on nostrService.
 */
export function querySyncAbortable(
  pool: SimplePool,
  relays: string[],
  filter: Filter,
  params: { maxWait?: number; signal?: AbortSignal; rejectOnAllRelaysFailure?: boolean },
): Promise<NostrEvent[]> {
  return new Promise((resolve, reject) => {
    const events: NostrEvent[] = [];
    // SimplePool already de-dupes across relays (`_knownIds`), but this is
    // the one shared read path for reviews / comments / shipping / inbox — a
    // belt-and-braces Set keeps every caller free of duplicate rows/counts.
    const seen = new Set<string>();
    if (params.signal?.aborted || relays.length === 0) {
      resolve(events);
      return;
    }
    let settled = false;
    let closer: { close: (reason?: string) => void } | undefined;
    const onAbort = () => finish();
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      params.signal?.removeEventListener('abort', onAbort);
      try {
        closer?.close();
      } catch {
        // sub may already be closing (abort/eose race) — ignore.
      }
      if (error) reject(error);
      else resolve(events);
    };
    params.signal?.addEventListener('abort', onAbort, { once: true });
    closer = pool.subscribeMany(relays, filter, {
      maxWait: params.maxWait,
      abort: params.signal,
      onevent(event) {
        if (seen.has(event.id)) return;
        seen.add(event.id);
        events.push(event);
      },
      oneose() {
        // The pool emits aggregate EOSE immediately before aggregate close
        // when every connection failed. Let onclose inspect those reasons first.
        if (params.rejectOnAllRelaysFailure) queueMicrotask(() => finish());
        else finish();
      },
      onclose(reasons) {
        // nostr-tools hard-close reasons (abstract-relay.js): "relay connection
        // failed" / "timed out" (never connected), "relay connection closed" +
        // "websocket closed" (the socket dropped after connecting), and the
        // pool's "connection skipped by allowConnectingToRelay". A relay that
        // REFUSED the query — NIP-42 "auth was required and attempted, but
        // failed…", or a CLOSED with the NIP-01 "auth-required:" /
        // "restricted:" prefixes — didn't serve an empty result either.
        // Deliberate closes ("closed by caller", "… closed by us") are NOT
        // failures.
        const allFailed =
          params.rejectOnAllRelaysFailure &&
          !params.signal?.aborted &&
          events.length === 0 &&
          reasons.length > 0 &&
          reasons.every((reason) =>
            /^(?:relay )?connection (?:failed|timed out|closed|skipped by allowConnectingToRelay)$|^websocket closed$|^auth was required|^auth-required:|^restricted:/.test(
              reason,
            ),
          );
        finish(allFailed ? new Error('All relays failed to connect') : undefined);
      },
    });
    // A synchronous callback can finish before the closer is assigned.
    if (settled) closer.close();
  });
}
