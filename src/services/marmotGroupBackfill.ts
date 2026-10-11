// Bounding marmot-ts's group backfill (#perf rules).
//
// marmot-ts backfills a group with an UNBOUNDED `{kinds:[445], #h}` filter
// on every connect. Bound it without losing history:
//  - `since` = newest *ingested* event − slack, so app start doesn't
//    re-download a group's whole history;
//  - the backfill pages backwards in `limit`-sized pages, so a device that
//    was offline through > `limit` events still gets every commit it needs
//    to decrypt later epochs;
//  - the durable watermark only advances once that backfill is ingested.
//    GroupsManager.connect drains the backfill BEFORE opening the live
//    subscription, so a request's newest timestamp is held as pending and
//    committed when the subscription for that group opens.

import type { NostrNetworkInterface } from '@internet-privacy/marmot-ts';
import type { Event as NostrEvent, Filter } from 'nostr-tools';

const GROUP_EVENT_KIND = 445;
// Re-read this far behind the newest INGESTED kind-445 (honest clock drift
// between members). The watermark only advances after ingestion and ignores
// future-dated events, so a short margin loses nothing — and every second of
// margin is re-fetched and trial-decrypted on the JS thread at each app start
// (spec: `since` is a fetch hint — transports/nostr.md).
export const GROUP_BACKFILL_SLACK_SECS = 10 * 60;
const GROUP_BACKFILL_LIMIT = 500;
// Safety stop for the paged backfill (500 × 40 = 20k events per group).
const GROUP_BACKFILL_MAX_PAGES = 40;
// Relay `created_at` is sender-controlled: an event dated in the future
// (anyone can publish a kind-445 with a group's public `h` tag) must never
// push the durable since-watermark past real traffic.
const MAX_FUTURE_SKEW_SECS = 5 * 60;
const isPlausibleTimestamp = (createdAt: number) =>
  createdAt <= Math.floor(Date.now() / 1000) + MAX_FUTURE_SKEW_SECS;

export interface GroupBackfillWatermarks {
  /** Newest ingested kind-445 `created_at` per group `h` (read and updated). */
  watermarks: Map<string, number>;
  /** Persist an advanced watermark. */
  persist: (h: string, createdAt: number) => void;
  /** Backfill page size (default 500). */
  pageSize?: number;
}

/** `network`, with kind-445 group backfills bounded and paged (see above). */
export function boundGroupQueries(
  network: NostrNetworkInterface,
  { watermarks, persist, pageSize }: GroupBackfillWatermarks,
): NostrNetworkInterface {
  const groupH = (f: Filter) =>
    f.kinds?.includes(GROUP_EVENT_KIND) && f.since === undefined ? f['#h']?.[0] : undefined;
  const bound = (f: Filter): Filter => {
    const h = groupH(f);
    if (!h) return f;
    const seen = watermarks.get(h);
    return {
      ...f,
      limit: f.limit ?? pageSize ?? GROUP_BACKFILL_LIMIT,
      ...(seen ? { since: seen - GROUP_BACKFILL_SLACK_SECS } : {}),
    };
  };
  const pending = new Map<string, number>();
  const commit = (h: string, createdAt: number) => {
    if (!isPlausibleTimestamp(createdAt)) return;
    if (createdAt <= (watermarks.get(h) ?? 0)) return;
    watermarks.set(h, createdAt);
    persist(h, createdAt);
  };
  const hOf = (e: NostrEvent) => e.tags.find((t) => t[0] === 'h')?.[1];

  /** Page a bounded group filter backwards until a short page. */
  const backfill = async (relays: string[], f: Filter): Promise<NostrEvent[]> => {
    const limit = f.limit ?? GROUP_BACKFILL_LIMIT;
    const byId = new Map<string, NostrEvent>();
    let until: number | undefined;
    for (let page = 0; page < GROUP_BACKFILL_MAX_PAGES; page++) {
      const events = (await network.request(relays, {
        ...f,
        ...(until !== undefined ? { until } : {}),
      })) as NostrEvent[];
      const before = byId.size;
      for (const e of events) byId.set(e.id, e);
      if (events.length < limit || byId.size === before) break;
      until = Math.min(...events.map((e) => e.created_at));
    }
    return [...byId.values()];
  };

  return {
    ...network,
    request: async (relays, filters) => {
      const list = (Array.isArray(filters) ? filters : [filters]) as Filter[];
      const batches = await Promise.all(
        list.map((f) =>
          groupH(f)
            ? backfill(relays, bound(f))
            : (network.request(relays, f) as Promise<NostrEvent[]>),
        ),
      );
      const byId = new Map<string, NostrEvent>();
      for (const e of batches.flat()) byId.set(e.id, e);
      for (const e of byId.values()) {
        const h = e.kind === GROUP_EVENT_KIND ? hOf(e) : undefined;
        if (h && isPlausibleTimestamp(e.created_at) && e.created_at > (pending.get(h) ?? 0)) {
          pending.set(h, e.created_at);
        }
      }
      return [...byId.values()];
    },
    subscription: (relays, filters) => {
      const list = (Array.isArray(filters) ? filters : [filters]) as Filter[];
      const inner = network.subscription(relays, list.map(bound));
      return {
        subscribe: (observer) => {
          // Backfill for these groups has been ingested — commit it.
          for (const f of list) {
            const h = groupH(f);
            const ts = h ? pending.get(h) : undefined;
            if (h && ts) {
              commit(h, ts);
              pending.delete(h);
            }
          }
          return inner.subscribe({
            ...observer,
            next: (e) => {
              const ev = e as NostrEvent;
              const h = ev.kind === GROUP_EVENT_KIND ? hOf(ev) : undefined;
              if (h) commit(h, ev.created_at);
              observer.next?.(e);
            },
          });
        },
      };
    },
  };
}
