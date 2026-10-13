import type { Event, Filter } from 'nostr-tools';
import { matchFilter } from 'nostr-tools/filter';
import { createYieldScheduler } from '../contexts/nostrDecryptPacing';
import { GROUP_BACKFILL_SLACK_SECS, pageGroupHistory } from './marmotGroupBackfill';

export type GroupHistoryRequest = (
  urls: string[],
  filter: Filter,
  signal: AbortSignal,
) => Promise<Event[]>;

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
  let pending: Promise<void> | undefined;
  let buffered: Event[] = [];
  let stalled = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 1000;
  const deliver = (event: Event) => {
    if (abort.signal.aborted || seen.has(event.id)) return;
    if (event.tags.filter((tag) => tag[0] === 'h').length !== 1) return;
    if (!filters.some((filter) => matchFilter(filter, event))) return;
    next(event);
    seen.add(event.id);
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
        let complete = false;
        try {
          for (const filter of filters)
            for (const h of filter['#h'] ?? []) {
              if (abort.signal.aborted) return;
              const cursor = cursors.get(h);
              const since =
                cursor === undefined
                  ? filter.since
                  : Math.max(filter.since ?? 0, cursor - GROUP_BACKFILL_SLACK_SECS);
              const events = await pageGroupHistory(
                (relays, page) => request(relays, page, abort.signal),
                urls,
                { ...filter, '#h': [h], since, limit: filter.limit ?? 500 },
                true,
                abort.signal,
                pacing.maybeYield,
              );
              for (const event of events) {
                deliver(event);
                await pacing.maybeYield();
              }
            }
          // Keep pending set while yielding: new live events join the next batch.
          while (buffered.length && !abort.signal.aborted) {
            const batch = buffered.sort((a, b) => a.created_at - b.created_at);
            buffered = [];
            for (const event of batch) {
              if (abort.signal.aborted) return;
              deliver(event);
              await pacing.maybeYield();
            }
          }
          complete = !abort.signal.aborted;
        } catch (error) {
          if (!abort.signal.aborted) console.warn('[Marmot] group recovery failed', error);
        } finally {
          pacing.dispose();
          // Live traffic cannot advance a cursor past a commit still being fetched.
          stalled = !complete;
          pending = undefined;
          if (complete) retryDelay = 1000;
          else if (!abort.signal.aborted) {
            retryTimer = setTimeout(() => {
              retryTimer = undefined;
              void recovery.recover();
            }, retryDelay);
            retryDelay = Math.min(retryDelay * 2, 30_000);
          }
        }
      });
      return pending;
    },
    receive: (event: Event) => {
      if (!filters.some((filter) => matchFilter(filter, event))) return;
      if (pending || stalled) buffered.push(event);
      else deliver(event);
    },
    close: () => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = undefined;
      abort.abort();
      buffered = [];
    },
  };
  return recovery;
}
