import {
  LIVE_UPDATE_FLUSH_MS,
  clearLiveUpdates,
  getLiveUpdate,
  getLiveUpdatesVersion,
  ingestLiveUpdate,
  subscribeLiveUpdates,
} from './liveLocationUpdateStore';

const ALICE = 'a'.repeat(64);
const MALLORY = 'f'.repeat(64);
const ping = (ts: number, lat = 51.5, sessionId = 's1') => ({
  lat,
  lon: -0.12,
  accuracy: 10,
  heading: null,
  ts,
  sessionId,
});

beforeEach(() => {
  jest.useFakeTimers();
  clearLiveUpdates();
});
afterEach(() => jest.useRealTimers());

it('keeps the newest fix per sender + session and drops stale or duplicate ones', () => {
  expect(ingestLiveUpdate(ALICE, ping(2000, 51.6))).toBe(true);
  expect(ingestLiveUpdate(ALICE, ping(1000, 40))).toBe(false); // out of order
  expect(ingestLiveUpdate(ALICE, ping(2000, 41))).toBe(false); // duplicate
  expect(getLiveUpdate(ALICE, 's1')).toEqual({
    location: { lat: 51.6, lon: -0.12, accuracyMeters: 10 },
    ts: 2000,
  });
});

it('keys by sender, so someone re-using a session id cannot move another marker', () => {
  ingestLiveUpdate(ALICE, ping(1000, 51.5));
  ingestLiveUpdate(MALLORY, ping(9999, 0));
  expect(getLiveUpdate(ALICE, 's1')!.location.lat).toBe(51.5);
  // Case-insensitive sender keys.
  expect(getLiveUpdate(ALICE.toUpperCase(), 's1')).toBeDefined();
});

it('coalesces a burst into ONE notification per flush window', () => {
  const listener = jest.fn();
  const unsubscribe = subscribeLiveUpdates(listener);
  const before = getLiveUpdatesVersion();
  for (let i = 1; i <= 50; i++) ingestLiveUpdate(ALICE, ping(i * 1000, 51, `s${i % 5}`));
  expect(listener).not.toHaveBeenCalled();
  jest.advanceTimersByTime(LIVE_UPDATE_FLUSH_MS);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(getLiveUpdatesVersion()).toBe(before + 1);
  // Nothing new → no further flush.
  jest.advanceTimersByTime(LIVE_UPDATE_FLUSH_MS * 4);
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  ingestLiveUpdate(ALICE, ping(999_999));
  jest.advanceTimersByTime(LIVE_UPDATE_FLUSH_MS);
  expect(listener).toHaveBeenCalledTimes(1);
});

it('a stale update schedules no flush', () => {
  ingestLiveUpdate(ALICE, ping(5000));
  jest.advanceTimersByTime(LIVE_UPDATE_FLUSH_MS);
  const listener = jest.fn();
  subscribeLiveUpdates(listener);
  ingestLiveUpdate(ALICE, ping(4000));
  jest.advanceTimersByTime(LIVE_UPDATE_FLUSH_MS);
  expect(listener).not.toHaveBeenCalled();
});

it('clear forgets everything and notifies (sign-out / account switch)', () => {
  ingestLiveUpdate(ALICE, ping(1000));
  const listener = jest.fn();
  subscribeLiveUpdates(listener);
  clearLiveUpdates();
  expect(getLiveUpdate(ALICE, 's1')).toBeUndefined();
  expect(listener).toHaveBeenCalledTimes(1);
});
