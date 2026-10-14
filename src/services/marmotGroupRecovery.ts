import type { Event, Filter } from 'nostr-tools';
import { matchFilter } from 'nostr-tools/filter';
import { createYieldScheduler } from '../contexts/nostrDecryptPacing';
import {
  GROUP_BACKFILL_MAX_EVENTS,
  GROUP_BACKFILL_SLACK_SECS,
  byTimeThenId,
  pageGroupHistoryStatus,
} from './marmotGroupBackfill';

export type GroupHistoryRequest = (
  urls: string[],
  filter: Filter,
  signal: AbortSignal,
) => Promise<Event[]>;

/** Live events held while history is outstanding. Past this the buffer is
 * dropped and the cursor retained, so the omitted events return through the
 * next history pass instead of staying resident behind a failing relay. */
export const MAX_BUFFERED_EVENTS = 1_000;
/** Delivered ids kept for cross-relay and overlap deduplication. */
const MAX_SEEN_EVENTS = 5_000;

/** Per-owner history and delivery ordering, independent of the merged live REQ. */
export function createGroupRecovery(
  urls: string[],
  filters: Filter[],
  next: (event: Event) => void,
  request: GroupHistoryRequest,
) {
  const abort = new AbortController();
  const seen = new Set<string>();
  const cursors = new Map<string, number>();
  // A pass that hit the page cap with older events unread: continue below
  // `until` next pass. Delivering the newest pages alone would advance the
  // cursor past the commits still missing (MLS needs the older ones first).
  // `truncated`: the memory cap dropped the newest events; they are re-read
  // from the advanced cursor once the retained older range is delivered.
  const partial = new Map<
    string,
    { events: Map<string, Event>; until: number; truncated: boolean }
  >();
  let pending: Promise<void> | undefined;
  let buffered = new Map<string, Event>();
  let overflowed = false;
  let stalled = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 1000;
  const deliver = (event: Event) => {
    if (abort.signal.aborted || seen.has(event.id)) return;
    if (event.tags.filter((tag) => tag[0] === 'h').length !== 1) return;
    if (!filters.some((filter) => matchFilter(filter, event))) return;
    next(event);
    seen.add(event.id);
    if (seen.size > MAX_SEEN_EVENTS) seen.delete(seen.values().next().value!);
    const h = event.tags.find((tag) => tag[0] === 'h')![1];
    if (event.created_at <= Math.floor(Date.now() / 1000) + 300)
      cursors.set(h, Math.max(cursors.get(h) ?? 0, event.created_at));
  };
  const recovery = {
    recover: (): Promise<void> => {
      if (pending) return pending;
      if (abort.signal.aborted) return Promise.resolve();
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = undefined;
      // Defer requests until the physical arm and budget reservation have finished.
      pending = Promise.resolve().then(async () => {
        const pacing = createYieldScheduler({
          signal: abort.signal,
          safetyEvery: 32,
          coldStart: true,
        });
        // Anything dropped before this pass is inside its `since` window.
        overflowed = false;
        let complete = false;
        let continuing = false;
        try {
          for (const filter of filters)
            for (const h of filter['#h'] ?? []) {
              if (abort.signal.aborted) return;
              const cursor = cursors.get(h);
              const since =
                cursor === undefined
                  ? filter.since
                  : Math.max(filter.since ?? 0, cursor - GROUP_BACKFILL_SLACK_SECS);
              const resume = partial.get(h);
              const { events, exhausted, saturated } = await pageGroupHistoryStatus(
                (relays, page) => request(relays, page, abort.signal),
                urls,
                {
                  ...filter,
                  '#h': [h],
                  since,
                  limit: filter.limit ?? 500,
                  ...(resume ? { until: resume.until } : {}),
                },
                true,
                abort.signal,
                pacing.maybeYield,
              );
              if (abort.signal.aborted) return;
              if (saturated)
                console.warn(
                  '[Marmot] group history: a relay page held fewer events than share one second; some may be unreachable',
                );
              let collected = resume?.events ?? new Map<string, Event>();
              let truncated = resume?.truncated ?? false;
              // Delivered overlap (cursor slack) must not count toward the cap.
              for (const event of events) if (!seen.has(event.id)) collected.set(event.id, event);
              if (collected.size > GROUP_BACKFILL_MAX_EVENTS) {
                // Memory cap: keep the OLDEST events (MLS needs them first) and
                // drop the newest, which the pass after delivery re-reads from
                // the advanced cursor. Delivering the newest instead would
                // advance the cursor past every older commit.
                const kept = [...collected.values()]
                  .sort(byTimeThenId)
                  .slice(0, GROUP_BACKFILL_MAX_EVENTS);
                collected = new Map(kept.map((event) => [event.id, event]));
                if (!truncated)
                  console.warn(
                    `[Marmot] group history exceeds ${GROUP_BACKFILL_MAX_EVENTS} events; delivering in passes`,
                  );
                truncated = true;
              }
              if (!exhausted) {
                // Relay-clamped pages ran into the page cap: older events remain.
                partial.set(h, { events: collected, until: events[0].created_at, truncated });
                continuing = true;
                continue;
              }
              partial.delete(h);
              for (const event of [...collected.values()].sort(byTimeThenId)) {
                deliver(event);
                await pacing.maybeYield();
              }
              // Newer events were dropped at the cap: read them from the new cursor.
              if (truncated) continuing = true;
            }
          // Live traffic stays held until every group's range is complete, and
          // a dropped buffer is re-read from the retained cursor rather than
          // delivering survivors that would advance it past the omitted events.
          if (!continuing && !overflowed)
            // Keep pending set while yielding: new live events join the next batch.
            while (buffered.size && !abort.signal.aborted && !overflowed) {
              const batch = [...buffered.values()].sort((a, b) => a.created_at - b.created_at);
              buffered = new Map();
              for (const event of batch) {
                if (abort.signal.aborted) return;
                deliver(event);
                await pacing.maybeYield();
              }
            }
          complete = !abort.signal.aborted && !continuing && !overflowed;
        } catch (error) {
          if (!abort.signal.aborted) console.warn('[Marmot] group recovery failed', error);
        } finally {
          pacing.dispose();
          // Live traffic cannot advance a cursor past a commit still being fetched.
          stalled = !complete;
          pending = undefined;
          const progressed = complete || continuing || overflowed;
          if (progressed) retryDelay = 1000;
          if (!complete && !abort.signal.aborted) {
            retryTimer = setTimeout(() => {
              retryTimer = undefined;
              void recovery.recover();
            }, retryDelay);
            if (!progressed) retryDelay = Math.min(retryDelay * 2, 30_000);
          }
        }
      });
      return pending;
    },
    receive: (event: Event) => {
      if (!filters.some((filter) => matchFilter(filter, event))) return;
      if (!pending && !stalled) return deliver(event);
      if (overflowed || seen.has(event.id) || buffered.has(event.id)) return;
      if (buffered.size >= MAX_BUFFERED_EVENTS) {
        // Bounded memory under a failing relay: drop the buffer and let the
        // next history pass (from the unchanged cursor) re-read every event.
        buffered = new Map();
        overflowed = true;
        return;
      }
      buffered.set(event.id, event);
    },
    close: () => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = undefined;
      abort.abort();
      buffered = new Map();
      partial.clear();
    },
  };
  return recovery;
}
