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
  params: { maxWait?: number; signal?: AbortSignal },
): Promise<NostrEvent[]> {
  return new Promise((resolve) => {
    const events: NostrEvent[] = [];
    if (params.signal?.aborted) {
      resolve(events);
      return;
    }
    let settled = false;
    let closer: { close: (reason?: string) => void } | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        closer?.close();
      } catch {
        // sub may already be closing (abort/eose race) — ignore.
      }
      resolve(events);
    };
    closer = pool.subscribeMany(relays, filter, {
      maxWait: params.maxWait,
      abort: params.signal,
      onevent(event) {
        events.push(event);
      },
      oneose() {
        finish();
      },
    });
    // Resolve on abort too. nostr-tools closes the sub on abort, but it sets
    // `signal.onabort` (single-slot, overwritten when one signal is shared
    // across several parallel queries) — our additive listener fires for every
    // query and closes each sub, so a shared signal cancels them all.
    params.signal?.addEventListener('abort', finish, { once: true });
  });
}
