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
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => finish();
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
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
    // Own the EOSE deadline: nostr-tools reports its per-relay `maxWait` expiry
    // as a plain `oneose`, indistinguishable from "served everything". With
    // our own timer a stalled relay set that delivered NOTHING can fail closed
    // for callers that asked (shipping must not read as "no options"); partial
    // results still resolve, and callers without the flag keep resolving.
    if (params.maxWait !== undefined) {
      deadline = setTimeout(() => {
        if (params.rejectOnAllRelaysFailure && events.length === 0) {
          finish(new Error('Relay query timed out with no events'));
        } else {
          finish();
        }
      }, params.maxWait);
    }
    closer = pool.subscribeMany(relays, filter, {
      // The pool's own timeout sits 1 s behind ours so our deadline always
      // settles first (it still bounds the pool's connection-timeout maths).
      maxWait: params.maxWait !== undefined ? params.maxWait + 1000 : undefined,
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
        // nostr-tools close reasons, verbatim (abstract-relay.js / pool.js):
        // "connection failed" / "connection timed out" (optionally "relay "-
        // prefixed; never connected), "relay connection closed" + "websocket
        // closed" (the socket dropped after connecting), "auth timed out" (a
        // NIP-42 challenge never completed), and the pool's "connection skipped
        // by allowConnectingToRelay". A relay that
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
            /^(?:relay )?connection (?:failed|timed out|closed|skipped by allowConnectingToRelay)$|^websocket closed$|^auth timed out$|^auth was required|^auth-required:|^restricted:/.test(
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
