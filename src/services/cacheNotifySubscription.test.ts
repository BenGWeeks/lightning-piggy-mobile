// Tests for the foreground cache-activity subscriptions — kind-1111
// comments (#740) and kind-7516 found-logs (#760). The nostr-tools pool is
// mocked so we can assert the filter shape (incl. the #A vs #a tag), the
// empty-coord short-circuit, and the teardown wiring without a real relay.

const mockSubscribeMany = jest.fn();
const mockClose = jest.fn();
const mockTrackRelays = jest.fn();

jest.mock('./nostrService', () => ({
  pool: { subscribeMany: (...a: unknown[]) => mockSubscribeMany(...a) },
  trackRelays: (...a: unknown[]) => mockTrackRelays(...a),
}));

import {
  subscribeCacheCommentsForCoords,
  subscribeCacheFoundLogsForCoords,
} from './cacheNotifySubscription';
import { GC_COMMENT_KIND, GC_FOUND_LOG_KIND } from './nostrPlacesService';

const VIEWER = 'a'.repeat(64);
const RELAYS = ['wss://r.example'];
const COORDS = [`37516:${VIEWER}:my-piggy-d`, `37516:${VIEWER}:other-d`];

beforeEach(() => {
  jest.clearAllMocks();
  mockSubscribeMany.mockReturnValue({ close: mockClose });
});

it('no-ops when cacheCoords is empty (no filter armed, no relay tracking)', () => {
  const close = subscribeCacheCommentsForCoords({
    viewerPubkey: VIEWER,
    relays: RELAYS,
    cacheCoords: [],
    onEvent: jest.fn(),
  });
  expect(mockSubscribeMany).not.toHaveBeenCalled();
  expect(mockTrackRelays).not.toHaveBeenCalled();
  // The returned closer is still callable / a function.
  expect(typeof close).toBe('function');
  close();
  expect(mockClose).not.toHaveBeenCalled();
});

it("arms the sub with kind-1111 + #A filter on the viewer's cache coords", () => {
  subscribeCacheCommentsForCoords({
    viewerPubkey: VIEWER,
    relays: RELAYS,
    cacheCoords: COORDS,
    onEvent: jest.fn(),
  });
  expect(mockTrackRelays).toHaveBeenCalledWith(RELAYS);
  expect(mockSubscribeMany).toHaveBeenCalledTimes(1);
  const [relaysArg, filterArg] = mockSubscribeMany.mock.calls[0];
  expect(relaysArg).toEqual(RELAYS);
  expect(filterArg.kinds).toEqual([GC_COMMENT_KIND]);
  expect(filterArg['#A']).toEqual(COORDS);
  expect(typeof filterArg.since).toBe('number');
  expect(typeof filterArg.limit).toBe('number');
});

it('caps the lookback to 7 days', () => {
  const nowSec = Math.floor(Date.now() / 1000);
  subscribeCacheCommentsForCoords({
    viewerPubkey: VIEWER,
    relays: RELAYS,
    cacheCoords: COORDS,
    onEvent: jest.fn(),
  });
  const filterArg = mockSubscribeMany.mock.calls[0][1] as { since: number };
  // Should be ~ nowSec − 7 days, with a small tolerance for the second
  // tick during the test.
  expect(nowSec - filterArg.since).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 - 5);
  expect(nowSec - filterArg.since).toBeLessThanOrEqual(7 * 24 * 60 * 60 + 5);
});

it('returns a teardown that closes the underlying sub', () => {
  const close = subscribeCacheCommentsForCoords({
    viewerPubkey: VIEWER,
    relays: RELAYS,
    cacheCoords: COORDS,
    onEvent: jest.fn(),
  });
  close();
  expect(mockClose).toHaveBeenCalledTimes(1);
});

it("forwards onevent deliveries to the caller's onEvent", () => {
  const onEvent = jest.fn();
  subscribeCacheCommentsForCoords({
    viewerPubkey: VIEWER,
    relays: RELAYS,
    cacheCoords: COORDS,
    onEvent,
  });
  const handlers = mockSubscribeMany.mock.calls[0][2] as { onevent: (e: unknown) => void };
  const fake = { id: 'c1', kind: 1111, pubkey: 'finder', created_at: 1, tags: [], content: '' };
  handlers.onevent(fake);
  expect(onEvent).toHaveBeenCalledWith(fake);
});

it('swallows a teardown exception (best-effort, never throws to caller)', () => {
  mockClose.mockImplementationOnce(() => {
    throw new Error('relay went away');
  });
  const close = subscribeCacheCommentsForCoords({
    viewerPubkey: VIEWER,
    relays: RELAYS,
    cacheCoords: COORDS,
    onEvent: jest.fn(),
  });
  expect(() => close()).not.toThrow();
});

// --- found-logs (kind-7516, #a lowercase) — #760 ---

it("arms the found-log sub with kind-7516 + #a (lowercase) filter on the viewer's coords", () => {
  subscribeCacheFoundLogsForCoords({
    viewerPubkey: VIEWER,
    relays: RELAYS,
    cacheCoords: COORDS,
    onEvent: jest.fn(),
  });
  expect(mockTrackRelays).toHaveBeenCalledWith(RELAYS);
  expect(mockSubscribeMany).toHaveBeenCalledTimes(1);
  const [, filterArg] = mockSubscribeMany.mock.calls[0];
  expect(filterArg.kinds).toEqual([GC_FOUND_LOG_KIND]);
  // Lowercase `#a` — buildFoundLog writes ["a", coord]; the uppercase
  // `#A` used for comments would never match a found-log.
  expect(filterArg['#a']).toEqual(COORDS);
  expect(filterArg['#A']).toBeUndefined();
  expect(typeof filterArg.since).toBe('number');
  expect(typeof filterArg.limit).toBe('number');
});

it('found-log sub no-ops on empty coords (no firehose request)', () => {
  const close = subscribeCacheFoundLogsForCoords({
    viewerPubkey: VIEWER,
    relays: RELAYS,
    cacheCoords: [],
    onEvent: jest.fn(),
  });
  expect(mockSubscribeMany).not.toHaveBeenCalled();
  expect(mockTrackRelays).not.toHaveBeenCalled();
  expect(typeof close).toBe('function');
});

it('found-log sub forwards onevent deliveries and tears down', () => {
  const onEvent = jest.fn();
  const close = subscribeCacheFoundLogsForCoords({
    viewerPubkey: VIEWER,
    relays: RELAYS,
    cacheCoords: COORDS,
    onEvent,
  });
  const handlers = mockSubscribeMany.mock.calls[0][2] as { onevent: (e: unknown) => void };
  const fake = { id: 'f1', kind: 7516, pubkey: 'finder', created_at: 1, tags: [], content: '' };
  handlers.onevent(fake);
  expect(onEvent).toHaveBeenCalledWith(fake);
  close();
  expect(mockClose).toHaveBeenCalledTimes(1);
});
