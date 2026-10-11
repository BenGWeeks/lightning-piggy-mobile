import type { NostrNetworkInterface } from '@internet-privacy/marmot-ts';
import type { Event as NostrEvent, Filter } from 'nostr-tools';

import { boundGroupQueries, GROUP_BACKFILL_SLACK_SECS } from './marmotGroupBackfill';

const H = 'a'.repeat(64);
const now = () => Math.floor(Date.now() / 1000);
const groupEvent = (id: number, createdAt: number, h = H) =>
  ({
    id: String(id).padStart(64, '0'),
    kind: 445,
    created_at: createdAt,
    tags: [['h', h]],
    content: '',
    pubkey: '',
    sig: '',
  }) as NostrEvent;

/** A fake relay holding `events`, honouring kinds / #h / since / until / limit (newest first). */
function fakeNetwork(events: NostrEvent[]) {
  const requests: Filter[] = [];
  let live: ((e: NostrEvent) => void) | undefined;
  const subscribed: Filter[][] = [];
  const network = {
    publish: async () => ({}),
    request: async (_relays: string[], filters: Filter | Filter[]) => {
      const f = (Array.isArray(filters) ? filters[0] : filters) as Filter;
      requests.push(f);
      return events
        .filter((e) => !f.kinds || f.kinds.includes(e.kind))
        .filter((e) => !f['#h'] || f['#h'].includes(e.tags[0][1]))
        .filter((e) => f.since === undefined || e.created_at >= f.since)
        .filter((e) => f.until === undefined || e.created_at <= f.until)
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, f.limit ?? Infinity);
    },
    subscription: (_relays: string[], filters: Filter | Filter[]) => {
      subscribed.push(filters as Filter[]);
      return {
        subscribe: (observer: { next?: (e: NostrEvent) => void }) => {
          live = (e) => observer.next?.(e);
          return { unsubscribe: () => (live = undefined) };
        },
      };
    },
  } as unknown as NostrNetworkInterface;
  return { network, requests, subscribed, emit: (e: NostrEvent) => live?.(e) };
}

describe('boundGroupQueries — bounded, paged kind-445 group backfill', () => {
  it('pages backwards until a short page so no commit is missed', async () => {
    const t = now() - 1000;
    const events = Array.from({ length: 7 }, (_, i) => groupEvent(i + 1, t + i));
    const net = fakeNetwork(events);
    const bounded = boundGroupQueries(net.network, {
      watermarks: new Map(),
      persist: jest.fn(),
      pageSize: 3,
    });
    const got = await bounded.request(['wss://r'], { kinds: [445], '#h': [H] });
    expect(got).toHaveLength(7);
    expect(net.requests.every((f) => f.limit === 3)).toBe(true);
    expect(net.requests.length).toBeGreaterThan(1);
  });

  it('starts from the stored watermark minus slack, and leaves other filters alone', async () => {
    const seen = now() - 5000;
    const net = fakeNetwork([]);
    const bounded = boundGroupQueries(net.network, {
      watermarks: new Map([[H, seen]]),
      persist: jest.fn(),
    });
    await bounded.request(['wss://r'], { kinds: [445], '#h': [H] });
    await bounded.request(['wss://r'], { kinds: [1], authors: ['b'] });
    expect(net.requests[0]).toMatchObject({ since: seen - GROUP_BACKFILL_SLACK_SECS, limit: 500 });
    expect(net.requests[1]).toEqual({ kinds: [1], authors: ['b'] });
  });

  it('commits the backfill watermark only once the live subscription opens, ignoring future-dated events', async () => {
    const t = now() - 100;
    const net = fakeNetwork([groupEvent(1, t), groupEvent(2, now() + 3600)]);
    const watermarks = new Map<string, number>();
    const persist = jest.fn();
    const bounded = boundGroupQueries(net.network, { watermarks, persist });
    await bounded.request(['wss://r'], { kinds: [445], '#h': [H] });
    expect(persist).not.toHaveBeenCalled(); // fetched, not yet ingested

    bounded.subscription(['wss://r'], [{ kinds: [445], '#h': [H] }]).subscribe({});
    expect(watermarks.get(H)).toBe(t);
    expect(persist).toHaveBeenCalledWith(H, t);

    net.emit(groupEvent(3, t + 50)); // live traffic advances it
    net.emit(groupEvent(4, now() + 3600)); // a future-dated one never does
    expect(watermarks.get(H)).toBe(t + 50);
    expect(persist).toHaveBeenLastCalledWith(H, t + 50);
  });
});
