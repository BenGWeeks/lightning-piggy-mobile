import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

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
jest.mock('./liveLocationNotification', () => ({ dismissLiveShareNotification: jest.fn() }));

import {
  getTrackingMode,
  handleTaskLocations,
  headlessLiveSessions,
  liveUpdateDispatcher,
  newestFix,
  setLiveLocationFixHandler,
  startTracking,
  stopSharingHeadless,
  stopTracking,
} from './liveLocationTracker';
import { loadPersistedSessions, savePersistedSessions } from './liveLocationStorage';
import type { OutgoingSession } from './liveLocationStateMachine';

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

it('falls back to the foreground watcher when background updates are unavailable', async () => {
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
