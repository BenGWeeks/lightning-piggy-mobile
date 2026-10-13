import { AbstractRelay } from 'nostr-tools/abstract-relay';
import type { Event, VerifiedEvent } from 'nostr-tools/pure';
import { pool } from './nostrPool';
import { fetchSingleLatest } from './nostrLatestQuery';

jest.mock('./nostrPool', () => ({
  pool: new (jest.requireActual('nostr-tools/pool').SimplePool)(),
  trackRelays: jest.fn(),
  DEFAULT_RELAYS: ['wss://slow.example/'],
}));

let relay: AbstractRelay;
beforeEach(() => {
  jest.useFakeTimers();
  relay = new AbstractRelay('wss://slow.example/', {
    verifyEvent: (event): event is VerifiedEvent => true,
  });
  jest.spyOn(relay, 'send').mockResolvedValue();
  jest.spyOn(pool, 'ensureRelay').mockResolvedValue(relay);
});
afterEach(() => {
  relay.close();
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});

test.each([
  [undefined, undefined, 5000, 8000],
  [6000, 4000, 6000, 10_000],
])(
  'recovers a late result through the configured hard deadline (%s + %s)',
  async (softTimeoutMs, keepOpenMs, softDeadline, hardDeadline) => {
    const onLatest = jest.fn();
    const result = fetchSingleLatest(
      { kinds: [3], authors: ['me'], limit: 1 },
      ['wss://slow.example/'],
      (tags) => tags[0][1],
      { softTimeoutMs, keepOpenMs, onLatest },
    );
    await jest.advanceTimersByTimeAsync(4500);
    expect(relay.openSubs.size).toBe(1);
    await jest.advanceTimersByTimeAsync(softDeadline - 4500);
    await expect(result).resolves.toBeNull();
    await jest.advanceTimersByTimeAsync(hardDeadline - softDeadline - 1);
    const sub = [...relay.openSubs.values()][0];
    expect(sub).toBeDefined();
    sub.onevent?.({ tags: [['p', 'late']], created_at: 1 } as Event);
    await jest.advanceTimersByTimeAsync(2);
    expect(onLatest).toHaveBeenCalledTimes(1);
    expect(onLatest).toHaveBeenCalledWith('late');
    expect(relay.openSubs.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  },
);
