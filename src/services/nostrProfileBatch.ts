import type { Filter } from 'nostr-tools/filter';

import { pool, trackRelays } from './nostrService';

/**
 * Stream a single batch of kind-0 (profile) events.
 *
 * Replaces the previous `pool.querySync()`-based pattern which waited for
 * EVERY relay in the set to send EOSE before returning anything. With long
 * lists like Ben's 590-contact set this measured ~31s for 580/590 profiles in
 * the #372 trace, dominated by per-batch waits against the slowest relay. We
 * instead open a sub, collect events as they arrive (tracking the newest
 * kind-0 per pubkey by `created_at`), and close on either of two conditions:
 *
 *  1. Early-exit — every requested pubkey has produced a kind-0, so there is
 *     nothing left to wait for. On a large follow list this is the difference
 *     between ~seconds and ~90s: the soft-timeout used to elapse in full for
 *     each 10s batch even when all profiles had already arrived, so a
 *     pull-to-refresh caller blocked ~90s. (#852)
 *  2. Soft-timeout fallback — backstops pubkeys that never answer.
 *
 * Events are surfaced to the caller via `onEvent` so the UI can paint each
 * name/avatar the moment it lands instead of waiting for the batch to finish.
 * (#372 follow-up)
 */
export async function fetchProfilesBatch(
  pubkeys: string[],
  relays: string[],
  softTimeoutMs: number,
  onEvent: (event: { pubkey: string; content: string; created_at: number }) => void,
): Promise<void> {
  if (pubkeys.length === 0) return;
  trackRelays(relays);
  // Deduped set of the pubkeys we're waiting on — see condition (1) above.
  const wanted = new Set(pubkeys);
  return new Promise<void>((resolve) => {
    const best = new Map<string, number>(); // pubkey → best created_at seen
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sub: { close: () => void } | null = null;
    const finish = (): void => {
      if (closed) return;
      closed = true;
      if (timer !== null) clearTimeout(timer);
      try {
        sub?.close();
      } catch {
        // best-effort
      }
      resolve();
    };
    sub = pool.subscribeMany(relays, { kinds: [0], authors: pubkeys } as Filter, {
      onevent: (ev: { pubkey: string; content: string; created_at: number }) => {
        // Keep only the newest kind-0 per pubkey — Nostr clients can
        // re-publish kind-0 with edits and we want the latest.
        const prev = best.get(ev.pubkey);
        if (prev !== undefined && ev.created_at <= prev) return;
        best.set(ev.pubkey, ev.created_at);
        onEvent(ev);
        // Every requested pubkey has now produced a kind-0 — no reason to
        // hold the sub open for the rest of the soft-timeout. (#852)
        if (best.size >= wanted.size) finish();
      },
    });
    timer = setTimeout(finish, softTimeoutMs);
  });
}
