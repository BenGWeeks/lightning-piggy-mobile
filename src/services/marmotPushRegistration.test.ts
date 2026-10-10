import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { DeviceRegistration } from './marmotPushEntries';

const mockSession = {
  pushRegistration: {
    setRegistration: jest.fn(),
    schedule: jest.fn(),
    sync: jest.fn(async () => ({ published: 2, removed: 0, pending: 0, declined: false })),
    pendingCount: jest.fn(async () => 0),
  },
};
let mockActive: typeof mockSession | null = mockSession;

jest.mock('./marmotSession', () => ({
  getMarmotSession: () => mockActive,
  subscribeMarmotSession: (l: (s: unknown) => void) => {
    l(mockActive);
    return () => undefined;
  },
}));
jest.mock('./notificationService', () => ({
  requestNotificationPermission: jest.fn(async () => true),
}));
jest.mock('./marmotNetwork', () => ({
  createPushTransport: () => ({ inboxRelays: async () => ['wss://inbox.example'] }),
}));
jest.mock('expo-application', () => ({ applicationId: 'com.lightningpiggy.app' }));
jest.mock('expo-notifications', () => ({
  getDevicePushTokenAsync: jest.fn(async () => ({ type: 'android', data: 'fcm-token-1' })),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  unregisterForNotificationsAsync: jest.fn(async () => undefined),
  registerTaskAsync: jest.fn(async () => null),
  unregisterTaskAsync: jest.fn(async () => null),
}));
jest.mock('expo-task-manager', () => ({
  isTaskDefined: () => true,
  defineTask: jest.fn(),
}));

// Loaded after the mocks.
import {
  BUILT_IN_SERVERS,
  builtInServer,
  disableMarmotPush,
  enableMarmotPush,
  loadMarmotPushSettings,
  parseServerKey,
  retireMarmotPushForAccount,
  setMarmotPushServer,
} from './marmotPushRegistration';
import { requestNotificationPermission } from './notificationService';

const lastRegistration = (): DeviceRegistration | null => {
  const calls = mockSession.pushRegistration.setRegistration.mock.calls as unknown as [
    DeviceRegistration | null,
  ][];
  return calls[calls.length - 1]?.[0] ?? null;
};

// The wake task is Android-only (iOS shows the server's alert itself).
beforeAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
});

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockActive = mockSession;
});

describe('server selection', () => {
  it('uses the production server only for the production app id', () => {
    expect(builtInServer('com.lightningpiggy.app')).toBe(BUILT_IN_SERVERS.production);
    expect(builtInServer('com.lightningpiggy.app.preview')).toBe(BUILT_IN_SERVERS.preview);
    // Dev shares the preview server (same Firebase project).
    expect(builtInServer('com.lightningpiggy.app.dev')).toBe(BUILT_IN_SERVERS.preview);
  });

  it('parses npub and hex keys and rejects junk', () => {
    const npub = 'npub1v5lrt4u7vhfnmxwk6c3uepcsrvs4jqyy3z3jrfm5kw73yp0wv2ts5pnwjs';
    expect(parseServerKey(npub)).toBe(BUILT_IN_SERVERS.production.pubkey);
    expect(parseServerKey(` ${BUILT_IN_SERVERS.preview.pubkey.toUpperCase()} `)).toBe(
      BUILT_IN_SERVERS.preview.pubkey,
    );
    expect(parseServerKey('npub1nope')).toBeNull();
    expect(parseServerKey('abc')).toBeNull();
  });
});

describe('enable / disable', () => {
  it('is off by default', async () => {
    expect(await loadMarmotPushSettings()).toEqual({ enabled: false, customServer: null });
  });

  it('enabling persists, registers the wake task and syncs interactively', async () => {
    const outcome = await enableMarmotPush();
    expect(outcome).toEqual({
      status: 'enabled',
      sync: { published: 2, removed: 0, pending: 0, declined: false },
    });
    expect((await loadMarmotPushSettings()).enabled).toBe(true);
    expect(Notifications.registerTaskAsync).toHaveBeenCalledWith('lp-marmot-push-wake');
    expect(mockSession.pushRegistration.sync).toHaveBeenCalledWith({ interactive: true });
    const reg = lastRegistration();
    expect(reg).toMatchObject({
      platform: 'fcm',
      server: BUILT_IN_SERVERS.production.pubkey,
      relayHint: 'wss://nos.lol',
    });
    expect(reg?.fingerprint).toMatch(/^sha256:[0-9a-f]{24}$/);
  });

  it('reports no permission without touching the token', async () => {
    (requestNotificationPermission as jest.Mock).mockResolvedValueOnce(false);
    expect(await enableMarmotPush()).toEqual({ status: 'no-permission' });
    expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect((await loadMarmotPushSettings()).enabled).toBe(false);
  });

  it('reports unavailable when Apple/Google give no token (no Play services)', async () => {
    (Notifications.getDevicePushTokenAsync as jest.Mock).mockRejectedValueOnce(
      new Error('SERVICE_NOT_AVAILABLE'),
    );
    expect(await enableMarmotPush()).toEqual({ status: 'unavailable' });
    expect((await loadMarmotPushSettings()).enabled).toBe(false);
  });

  it('disabling retracts (null registration) and then deletes the native token', async () => {
    await enableMarmotPush();
    await disableMarmotPush();
    expect(lastRegistration()).toBeNull();
    expect(mockSession.pushRegistration.sync).toHaveBeenLastCalledWith({ interactive: true });
    expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalled();
    expect(Notifications.unregisterTaskAsync).toHaveBeenCalledWith('lp-marmot-push-wake');
    expect((await loadMarmotPushSettings()).enabled).toBe(false);
  });

  it('a custom server is persisted with its inbox relay as the hint', async () => {
    await enableMarmotPush();
    await setMarmotPushServer(BUILT_IN_SERVERS.preview.pubkey);
    expect((await loadMarmotPushSettings()).customServer).toEqual({
      pubkey: BUILT_IN_SERVERS.preview.pubkey,
      relayHint: 'wss://inbox.example',
    });
    expect(lastRegistration()?.server).toBe(BUILT_IN_SERVERS.preview.pubkey);
    await setMarmotPushServer(null);
    expect((await loadMarmotPushSettings()).customServer).toBeNull();
    expect(lastRegistration()?.server).toBe(BUILT_IN_SERVERS.production.pubkey);
    await expect(setMarmotPushServer('npub1nope')).rejects.toThrow();
  });

  it('removing an account deletes the token and re-registers a fresh one', async () => {
    await enableMarmotPush();
    (Notifications.getDevicePushTokenAsync as jest.Mock).mockResolvedValueOnce({
      type: 'android',
      data: 'fcm-token-2',
    });
    await retireMarmotPushForAccount();
    expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalled();
    expect(Notifications.unregisterTaskAsync).not.toHaveBeenCalled();
    expect(lastRegistration()?.token).toEqual(new TextEncoder().encode('fcm-token-2'));
  });
});
