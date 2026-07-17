// Tests for the runtime publish/subscribe wrappers in nostrPlacesPublisher.
// The nostr-tools pool is mocked so we can assert filter shapes (incl. the
// 30-day `since` window added in #1029) without a real relay connection.

// Hoist mocks before imports (jest.mock is hoisted automatically by babel-jest;
// the vars are captured via the factory closures).
const mockSubscribeMany = jest.fn();
const mockClose = jest.fn();

jest.mock('./nostrService', () => ({
  pool: { subscribeMany: (...a: unknown[]) => mockSubscribeMany(...a) },
  DEFAULT_RELAYS: ['wss://default.example'],
  publishSignedEvent: jest.fn(),
}));

jest.mock('./devEventDenylist', () => ({
  isDevLeftover: () => false,
}));

jest.mock('./nostrPlacesService', () => ({
  GC_LISTING_KIND: 37516,
  GC_FOUND_LOG_KIND: 7516,
  parseCache: (e: unknown) => e,
  parseFoundLogEvent: (e: unknown) => e,
}));

jest.mock('./geocacheRelays', () => ({
  GC_RELAYS: ['wss://gc.example'],
}));

// eslint-disable-next-line import/first
import { subscribeRecentCaches, subscribeRecentFoundLogs } from './nostrPlacesPublisher';

beforeEach(() => {
  jest.clearAllMocks();
  mockSubscribeMany.mockReturnValue({ close: mockClose });
});

// ---------------------------------------------------------------------------
// subscribeRecentCaches — 30-day since window (#1029 Fix 2)
// ---------------------------------------------------------------------------

describe('subscribeRecentCaches', () => {
  it('includes a since field approximately 30 days in the past', () => {
    const before = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
    subscribeRecentCaches(jest.fn());
    const after = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
    expect(mockSubscribeMany).toHaveBeenCalledTimes(1);
    const [, filterArg] = mockSubscribeMany.mock.calls[0] as [unknown, { since: number }];
    // Allow ±5 s tolerance for the tick between `before` and `after`
    // (keeps the assertion deterministic under CI load).
    expect(filterArg.since).toBeGreaterThanOrEqual(before - 5);
    expect(filterArg.since).toBeLessThanOrEqual(after + 5);
  });

  it('retains the default limit of 200', () => {
    subscribeRecentCaches(jest.fn());
    const [, filterArg] = mockSubscribeMany.mock.calls[0] as [unknown, { limit: number }];
    expect(filterArg.limit).toBe(200);
  });

  it('targets kind 37516', () => {
    subscribeRecentCaches(jest.fn());
    const [, filterArg] = mockSubscribeMany.mock.calls[0] as [unknown, { kinds: number[] }];
    expect(filterArg.kinds).toEqual([37516]);
  });

  it('forwards parsed events to the callback', () => {
    const onEvent = jest.fn();
    subscribeRecentCaches(onEvent);
    const [, , handlers] = mockSubscribeMany.mock.calls[0] as [
      unknown,
      unknown,
      { onevent: (e: unknown) => void },
    ];
    const fake = { id: 'c1', kind: 37516, pubkey: 'pk', created_at: 1, tags: [], content: '' };
    handlers.onevent(fake);
    // parseCache is mocked to return the event as-is.
    expect(onEvent).toHaveBeenCalledWith(fake);
  });

  it('returns a teardown that closes the underlying subscription', () => {
    const close = subscribeRecentCaches(jest.fn());
    close();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// subscribeRecentFoundLogs — 30-day since window (#1029 Fix 2)
// ---------------------------------------------------------------------------

describe('subscribeRecentFoundLogs', () => {
  it('includes a since field approximately 30 days in the past', () => {
    const before = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
    subscribeRecentFoundLogs(jest.fn());
    const after = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
    expect(mockSubscribeMany).toHaveBeenCalledTimes(1);
    const [, filterArg] = mockSubscribeMany.mock.calls[0] as [unknown, { since: number }];
    // Allow ±5 s tolerance for the tick between `before` and `after`
    // (keeps the assertion deterministic under CI load).
    expect(filterArg.since).toBeGreaterThanOrEqual(before - 5);
    expect(filterArg.since).toBeLessThanOrEqual(after + 5);
  });

  it('retains the default limit of 200', () => {
    subscribeRecentFoundLogs(jest.fn());
    const [, filterArg] = mockSubscribeMany.mock.calls[0] as [unknown, { limit: number }];
    expect(filterArg.limit).toBe(200);
  });

  it('targets kind 7516', () => {
    subscribeRecentFoundLogs(jest.fn());
    const [, filterArg] = mockSubscribeMany.mock.calls[0] as [unknown, { kinds: number[] }];
    expect(filterArg.kinds).toEqual([7516]);
  });

  it('forwards parsed events to the callback', () => {
    const onEvent = jest.fn();
    subscribeRecentFoundLogs(onEvent);
    const [, , handlers] = mockSubscribeMany.mock.calls[0] as [
      unknown,
      unknown,
      { onevent: (e: unknown) => void },
    ];
    const fake = { id: 'l1', kind: 7516, pubkey: 'finder', created_at: 2, tags: [], content: '' };
    handlers.onevent(fake);
    expect(onEvent).toHaveBeenCalledWith(fake);
  });

  it('returns a teardown that closes the underlying subscription', () => {
    const close = subscribeRecentFoundLogs(jest.fn());
    close();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('both recent subs have independent since values (separate subscription time)', () => {
    subscribeRecentCaches(jest.fn());
    subscribeRecentFoundLogs(jest.fn());
    expect(mockSubscribeMany).toHaveBeenCalledTimes(2);
    const cachesSince = (mockSubscribeMany.mock.calls[0] as [unknown, { since: number }])[1].since;
    const logsSince = (mockSubscribeMany.mock.calls[1] as [unknown, { since: number }])[1].since;
    // Both should be within a few seconds of each other (test runs in <1 s).
    // Each is independently computed via RECENT_SINCE_SECS() at call time.
    // ±10 s is generous enough to be stable under CI load.
    expect(Math.abs(cachesSince - logsSince)).toBeLessThan(10);
  });
});
