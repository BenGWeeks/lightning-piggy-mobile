import type React from 'react';
import { InteractionManager } from 'react-native';
import type { RefreshDmInboxOptions } from './nostrContextTypes';

/**
 * Schedule the cold-start inbox backfill (#751).
 *
 * The first refresh of a session fetches only a recent slice of wraps
 * (COLD_INITIAL_WRAP_LIMIT) so the Messages tab paints fast instead of blocking
 * the JS thread on the full backlog ingest (~12 s for 508 wraps × 5 relays).
 * This tops up to the full backlog afterwards — but in the background:
 *
 *  - deferred via `runAfterInteractions` so it never blocks the tab transition;
 *  - carrying the original `signal`, so a tab-blur cancels it (the in-flight
 *    relay subscription closes via querySyncAbortable);
 *  - with `force: true`, which fetches the full limit, skips the `since` floor
 *    (NIP-59 wrap timestamps are randomised), and — crucially — marks this pass
 *    a non-cold-start, so it can never recurse.
 *
 * `refreshRef` (rather than the callback directly) keeps the caller from having
 * to list refreshDmInbox as its own dependency.
 */
export function scheduleColdStartBackfill(args: {
  isColdStart: boolean;
  signal?: AbortSignal;
  includeNonFollows: boolean;
  refreshRef: React.MutableRefObject<((opts?: RefreshDmInboxOptions) => Promise<void>) | null>;
}): void {
  if (!args.isColdStart || args.signal?.aborted) return;
  InteractionManager.runAfterInteractions(() => {
    // Re-check: the signal may have aborted between scheduling and now (e.g. a
    // tab blur during the interaction window). Skip so we don't toggle loading
    // state or advance the refresh TTL for a backfill the user no longer wants
    // (#752 Copilot). querySyncAbortable would also short-circuit, but bailing
    // here avoids the wasted refreshDmInbox setup entirely.
    if (args.signal?.aborted) return;
    void args.refreshRef.current?.({
      force: true,
      includeNonFollows: args.includeNonFollows,
      signal: args.signal,
    });
  });
}
