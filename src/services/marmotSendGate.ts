// Never hand marmot-ts a group send it would queue (#1280).
//
// marmot-ts gates outbound on convergence: right after a membership commit a
// group reads `Syncing` for a ~1 s quiescence window, and a send made then is
// queued until a one-shot settle check drains it. That check can misfire —
// its timer fires a hair early (status still `Syncing`, never re-armed), or
// the settle pass skips the drain after ingesting retained input — and the
// queued send then never goes out: the message sits in "sending" forever.
//
// The fix here uses only marmot-ts's public API: wait (bounded) until the
// group can publish right now, then submit in the same synchronous step, so
// `submitIntent` takes its publish-immediately branch and nothing is queued.
// The status is derived from the clock on every read, so it reaches
// `Settled` without the timer. A group that doesn't settle in time fails the
// send with MarmotGroupNotReadyError (the normal send-failed path — the user
// can retry) and leaves nothing queued to go out later behind that retry.
// Upstream report: /tmp/claude-1000/reviews/marmot-ts-upstream-1280.md.

import { groupLifecycleStates, type MarmotGroup } from '@internet-privacy/marmot-ts';

type Group = Pick<MarmotGroup, 'convergenceStatus' | 'lifecycle' | 'submitIntent'>;
export type GroupSendIntent = Parameters<MarmotGroup['submitIntent']>[0];
type GroupPublishResults = Awaited<ReturnType<MarmotGroup['submitIntent']>>;

/** How long a send waits for the group to settle before failing (retryable). */
export const SEND_SETTLE_TIMEOUT_MS = 20_000;
// Only polled while the group is mid-change (typically ≤ 1 s after a commit).
const SETTLE_POLL_MS = 100;

/** The group is still applying a change; the send didn't go out — try again. */
export class MarmotGroupNotReadyError extends Error {
  constructor() {
    super('marmot: group still applying a change');
    this.name = 'MarmotGroupNotReadyError';
  }
}

/** marmot-ts's own release rule (mayReleaseOutbound, not exported). */
export const canPublishNow = (group: Pick<Group, 'convergenceStatus' | 'lifecycle'>) =>
  group.convergenceStatus === 'Settled' && group.lifecycle === groupLifecycleStates.stable;

/**
 * Submit `intent` once the group can publish it immediately. Rejects with
 * MarmotGroupNotReadyError after `timeoutMs`, or with `stoppedError()` as soon
 * as `cancelled()` turns true (sign-out mid-wait).
 */
export async function submitWhenSettled(
  group: Group,
  intent: GroupSendIntent,
  opts: {
    timeoutMs?: number;
    cancelled?: () => boolean;
    stoppedError?: () => Error;
  } = {},
): Promise<GroupPublishResults> {
  const deadline = Date.now() + (opts.timeoutMs ?? SEND_SETTLE_TIMEOUT_MS);
  for (;;) {
    if (opts.cancelled?.()) throw opts.stoppedError?.() ?? new Error('marmot: session stopped');
    // Check and submit with no await between: submitIntent reads the same
    // gate synchronously on entry, so this can never land in its queue.
    if (canPublishNow(group)) return group.submitIntent(intent);
    if (Date.now() >= deadline) throw new MarmotGroupNotReadyError();
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  }
}
