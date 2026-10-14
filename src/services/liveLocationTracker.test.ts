import { loadIdentities } from './identitiesStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

import {
  getTrackingMode,
  handleTaskLocations,
  headlessLiveSessions,
  liveUpdateDispatcher,
  newestFix,
  setLiveLocationFixHandler,
  startTracking,
  reapOrphanedService,
  stopSharingHeadless,
  stopTracking,
} from './liveLocationTracker';
import { loadPersistedSessions, savePersistedSessions } from './liveLocationStorage';
import type { OutgoingSession } from './liveLocationStateMachine';
jest.mock('./identitiesStore', () => ({ loadIdentities: jest.fn() }));

jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  ActivityType: { Other: 1 },
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(async () => true),
  watchPositionAsync: jest.fn(),
}));
const mockSend = jest.fn();
jest.mock('./liveLocationSender', () => ({ sendLiveUpdate: (...a: unknown[]) => mockSend(...a) }));
const mockStopped = jest.fn();
jest.mock('./liveLocationNotification', () => ({
  dismissLiveShareNotification: jest.fn(),
  showLiveShareStoppedNotification: (...a: unknown[]) => mockStopped(...a),
}));

const loc = Location as jest.Mocked<typeof Location>;
const ME = 'a'.repeat(64);
const point = (ts: number, lat = 51.5) =>
  ({
    timestamp: ts,
    coords: { latitude: lat, longitude: -0.1, accuracy: 7.6, heading: -1 },
  }) as Location.LocationObject;
const session = (over: Partial<OutgoingSession> = {}): OutgoingSession => ({
  sessionId: 's1',
  senderPubkey: ME,
  recipientPubkey: 'b'.repeat(64),
  startedAt: Date.now() - 60_000,
  durationMs: 3_600_000,
  lastPingAt: null,
  status: 'paused',
  startMarkerSent: true,
  endMarkerSent: false,
  wire: 2,
  ...over,
});

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(loadIdentities).mockResolvedValue({ activePubkey: ME, identities: [] });
  await AsyncStorage.clear();
  await stopTracking();
  liveUpdateDispatcher.reset();
  setLiveLocationFixHandler(null);
});

it('newestFix picks the latest point in a batch and normalises it', () => {
  expect(newestFix([point(1, 10), point(3, 30), point(2, 20)])).toEqual({
    location: { lat: 30, lon: -0.1, accuracyMeters: 8 },
    heading: null, // negative heading = unknown
    ts: 3,
  });
  expect(newestFix([])).toBeNull();
  expect(newestFix(undefined)).toBeNull();
});

it('headlessLiveSessions keeps only started, unexpired, unstopped shares', () => {
  const now = Date.now();
  const out = headlessLiveSessions(
    [
      session({ sessionId: 'ok' }),
      session({ sessionId: 'stopped', stopRequested: true }),
      session({ sessionId: 'unsent', startMarkerSent: false }),
      session({ sessionId: 'done', endMarkerSent: true }),
      session({ sessionId: 'old', startedAt: now - 7_200_000 }),
    ],
    now,
  );
  expect(out.map((s) => [s.sessionId, s.status])).toEqual([['ok', 'active']]);
});

it('prefers background updates with an Android foreground service and the iOS indicator', async () => {
  loc.hasStartedLocationUpdatesAsync.mockResolvedValueOnce(false);
  loc.startLocationUpdatesAsync.mockResolvedValue(undefined);
  expect(await startTracking({ owner: ME, relays: ['wss://r'] })).toBe('background');
  const [, options] = loc.startLocationUpdatesAsync.mock.calls[0];
  expect(options).toMatchObject({
    distanceInterval: 0,
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'Sharing your live location',
      killServiceOnDestroy: false,
    },
  });
  expect(loc.watchPositionAsync).not.toHaveBeenCalled();
  // Idempotent while running.
  await startTracking({ owner: ME, relays: [] });
  expect(loc.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
});

it('adopts an already-running background service instead of re-starting it', async () => {
  // Android refuses to START a location service from the background (e.g.
  // after the JS restarted while a share ran on); the running one keeps going.
  loc.hasStartedLocationUpdatesAsync.mockResolvedValueOnce(true);
  expect(await startTracking({ owner: ME, relays: [] })).toBe('background');
  expect(loc.startLocationUpdatesAsync).not.toHaveBeenCalled();
});

it('falls back to the foreground watcher when background updates are unavailable', async () => {
  loc.hasStartedLocationUpdatesAsync.mockResolvedValueOnce(false);
  loc.startLocationUpdatesAsync.mockRejectedValue(new Error('LocationUpdatesUnavailable'));
  loc.watchPositionAsync.mockResolvedValue({ remove: jest.fn() } as never);
  expect(await startTracking({ owner: ME, relays: [] })).toBe('foreground');
  expect(getTrackingMode()).toBe('foreground');
  await stopTracking();
  expect(getTrackingMode()).toBeNull();
  expect(loc.stopLocationUpdatesAsync).toHaveBeenCalled();
});

it('task fixes go to the mounted provider', async () => {
  const handler = jest.fn();
  setLiveLocationFixHandler(handler);
  await handleTaskLocations([point(10)]);
  expect(handler).toHaveBeenCalledWith(expect.objectContaining({ ts: 10 }));
  expect(mockSend).not.toHaveBeenCalled();
});

it('headless: sends from the persisted shares with no provider mounted', async () => {
  loc.startLocationUpdatesAsync.mockResolvedValue(undefined);
  await startTracking({ owner: ME, relays: ['wss://r'] });
  await savePersistedSessions(ME, [session()]);
  mockSend.mockResolvedValue(true);
  await handleTaskLocations([point(Date.now())]);
  expect(mockSend).toHaveBeenCalledTimes(1);
  const [owner, sent, , relays] = mockSend.mock.calls[0];
  expect([owner, sent.sessionId, sent.status, relays]).toEqual([ME, 's1', 'active', ['wss://r']]);
});

it('headless: stops tracking once nothing is left to share', async () => {
  loc.startLocationUpdatesAsync.mockResolvedValue(undefined);
  await startTracking({ owner: ME, relays: [] });
  await savePersistedSessions(ME, [session({ stopRequested: true })]);
  await handleTaskLocations([point(Date.now())]);
  expect(mockSend).not.toHaveBeenCalled();
  expect(loc.stopLocationUpdatesAsync).toHaveBeenCalled();
  expect(getTrackingMode()).toBeNull();
});

it('Stop with no provider mounted stops tracking and marks the shares to end on next open', async () => {
  loc.startLocationUpdatesAsync.mockResolvedValue(undefined);
  await startTracking({ owner: ME, relays: [] });
  await savePersistedSessions(ME, [session()]);
  await stopSharingHeadless();
  expect(getTrackingMode()).toBeNull();
  const [stored] = await loadPersistedSessions(ME);
  expect(stored.stopRequested).toBe(true);
});

describe('headless runtime (no UI, e.g. after the OS restarted the process)', () => {
  const marmot = () => session({ sessionId: 'm1', protocol: 'marmot', label: 'Big Piggy' });

  it('ends a Marmot share cleanly and visibly, and keeps a NIP-17 share streaming', async () => {
    loc.startLocationUpdatesAsync.mockResolvedValue(undefined);
    await startTracking({ owner: ME, relays: [] });
    await savePersistedSessions(ME, [marmot(), session({ sessionId: 'n1' })]);
    mockSend.mockResolvedValue(true);
    await handleTaskLocations([point(Date.now())]);
    expect(mockSend.mock.calls.map((c) => c[1].sessionId)).toEqual(['n1']);
    const stored = await loadPersistedSessions(ME);
    expect(stored.find((s) => s.sessionId === 'm1')?.stopRequested).toBe(true);
    expect(mockStopped).toHaveBeenCalledWith(['Big Piggy']);
    expect(getTrackingMode()).toBe('background');
  });

  it('stops tracking when only Marmot shares were running', async () => {
    loc.startLocationUpdatesAsync.mockResolvedValue(undefined);
    await startTracking({ owner: ME, relays: [] });
    await savePersistedSessions(ME, [marmot()]);
    await handleTaskLocations([point(Date.now())]);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockStopped).toHaveBeenCalledTimes(1);
    expect(getTrackingMode()).toBeNull();
  });

  it('keeps the cadence across runtimes (expo rebuilds the headless JS per event)', async () => {
    loc.startLocationUpdatesAsync.mockResolvedValue(undefined);
    await startTracking({ owner: ME, relays: [] });
    await savePersistedSessions(ME, [session({ sessionId: 'n1' })]);
    mockSend.mockResolvedValue(true);
    const at = Date.now();
    await handleTaskLocations([point(at)]);
    liveUpdateDispatcher.reset(); // a fresh runtime
    await handleTaskLocations([point(at + 3_000)]);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

it('reaps the location service the OS restarts after a headless stop, once', async () => {
  loc.startLocationUpdatesAsync.mockResolvedValue(undefined);
  await startTracking({ owner: ME, relays: [] });
  await savePersistedSessions(ME, [session({ sessionId: 'm1', protocol: 'marmot' })]);
  await handleTaskLocations([point(Date.now())]); // headless: ends the share, stops tracking
  loc.startLocationUpdatesAsync.mockClear();
  loc.stopLocationUpdatesAsync.mockClear();
  await reapOrphanedService();
  expect(loc.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  expect(loc.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  await reapOrphanedService(); // marker consumed
  expect(loc.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
});

it('never reaps without a headless stop, or while tracking', async () => {
  await reapOrphanedService();
  expect(loc.startLocationUpdatesAsync).not.toHaveBeenCalled();
});
