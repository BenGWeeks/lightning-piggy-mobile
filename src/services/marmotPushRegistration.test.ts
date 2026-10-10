import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { DeviceRegistration } from './marmotPushEntries';

const mockSession = {
  pubkey: 'active-account',
  pushRegistration: {
    setRegistration: jest.fn(),
    schedule: jest.fn(),
    sync: jest.fn(async () => ({ published: 2, removed: 0, pending: 0, declined: false })),
    pendingCount: jest.fn(async () => 0),
    holdsRecords: jest.fn(async () => false),
    onSettled: jest.fn(() => () => undefined),
  },
};
let mockActive: typeof mockSession | null = mockSession;
let mockSessionListener: ((s: unknown) => void) | null = null;

jest.mock('./marmotSession', () => ({
  getMarmotSession: () => mockActive,
  subscribeMarmotSession: (l: (s: unknown) => void) => {
    mockSessionListener = l;
    l(mockActive);
    return () => undefined;
  },
}));
const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockSecure.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockSecure.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockSecure.delete(k)),
}));
let mockActivePubkey: string | null = 'active-account';
jest.mock('./walletStorageService', () => ({ getActivePubkey: () => mockActivePubkey }));
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
// The native token module, driven through the same controllable mock.
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: (name: string) =>
    name === 'ExpoPushTokenManager'
      ? {
          getDevicePushTokenAsync: async () =>
            (await jest.requireMock('expo-notifications').getDevicePushTokenAsync()).data,
        }
      : null,
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
  startMarmotPushRegistration,
  pendingMarmotPushGroups,
  syncMarmotPushNow,
  currentPushDevice,
  subscribePushDevice,
  __resetMarmotPushForTests,
} from './marmotPushRegistration';
import { requestNotificationPermission } from './notificationService';

const ME = 'active-account';
const enabledKey = (pubkey: string) => `marmot_push_enabled_v1_${pubkey}`;
const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};
const sessionFor = (pubkey: string) => ({
  ...mockSession,
  pubkey,
  pushRegistration: {
    ...mockSession.pushRegistration,
    setRegistration: jest.fn(),
    schedule: jest.fn(),
    sync: jest.fn(async () => ({ published: 1, removed: 0, pending: 0, declined: false })),
  },
});

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
  __resetMarmotPushForTests();
  mockActive = mockSession;
  mockActivePubkey = ME;
  mockSecure.clear();
});

describe('server selection', () => {
  it('picks the server by app id (dev → the sandbox/dev server)', () => {
    expect(builtInServer('com.lightningpiggy.app')).toBe(BUILT_IN_SERVERS.production);
    expect(builtInServer('com.lightningpiggy.app.preview')).toBe(BUILT_IN_SERVERS.preview);
    expect(parseServerKey('npub15vns5zhkr3vq95rg330gmtea6mz2xs24um0hey396nd06p8kfl9say2equ')).toBe(
      BUILT_IN_SERVERS.development.pubkey,
    );
    expect(builtInServer('com.lightningpiggy.app.dev', '')).toBe(BUILT_IN_SERVERS.development);
    // A bundle-time override wins for dev builds only.
    const npub = 'npub1v5lrt4u7vhfnmxwk6c3uepcsrvs4jqyy3z3jrfm5kw73yp0wv2ts5pnwjs';
    expect(builtInServer('com.lightningpiggy.app.dev', npub)).toEqual({
      pubkey: BUILT_IN_SERVERS.production.pubkey,
    });
    expect(builtInServer('com.lightningpiggy.app.preview', npub)).toBe(BUILT_IN_SERVERS.preview);
  });

  it('parses npub and hex keys and rejects junk', () => {
    const npub = 'npub1v5lrt4u7vhfnmxwk6c3uepcsrvs4jqyy3z3jrfm5kw73yp0wv2ts5pnwjs';
    expect(parseServerKey(npub)).toBe(BUILT_IN_SERVERS.production.pubkey);
    expect(parseServerKey(` ${BUILT_IN_SERVERS.preview.pubkey.toUpperCase()} `)).toBe(
      BUILT_IN_SERVERS.preview.pubkey,
    );
    expect(parseServerKey('npub1nope')).toBeNull();
    expect(parseServerKey('ff'.repeat(32))).toBeNull(); // not a curve point
    expect(parseServerKey('abc')).toBeNull();
  });
});

describe('enable / disable', () => {
  it('is off by default', async () => {
    expect(await loadMarmotPushSettings(ME)).toEqual({
      enabled: false,
      otherAccounts: false,
      customServer: null,
    });
  });

  it('enabling persists, registers the wake task and syncs interactively', async () => {
    const outcome = await enableMarmotPush(ME);
    expect(outcome).toEqual({
      status: 'enabled',
      sync: { published: 2, removed: 0, pending: 0, declined: false },
    });
    expect((await loadMarmotPushSettings(ME)).enabled).toBe(true);
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
    expect(await enableMarmotPush(ME)).toEqual({ status: 'no-permission' });
    expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect((await loadMarmotPushSettings(ME)).enabled).toBe(false);
  });

  it('reports unavailable when Apple/Google give no token (no Play services)', async () => {
    (Notifications.getDevicePushTokenAsync as jest.Mock).mockRejectedValueOnce(
      new Error('SERVICE_NOT_AVAILABLE'),
    );
    expect(await enableMarmotPush(ME)).toEqual({ status: 'unavailable' });
    expect((await loadMarmotPushSettings(ME)).enabled).toBe(false);
  });

  it('disabling retracts (null registration) and then deletes the native token', async () => {
    await enableMarmotPush(ME);
    expect((await disableMarmotPush(ME)).tokenDeleted).toBe(true);
    expect(lastRegistration()).toBeNull();
    expect(mockSession.pushRegistration.sync).toHaveBeenLastCalledWith({ interactive: true });
    expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalled();
    expect(Notifications.unregisterTaskAsync).toHaveBeenCalledWith('lp-marmot-push-wake');
    expect((await loadMarmotPushSettings(ME)).enabled).toBe(false);
  });

  it('a custom server is persisted with its inbox relay as the hint', async () => {
    await enableMarmotPush(ME);
    await setMarmotPushServer(BUILT_IN_SERVERS.preview.pubkey);
    expect((await loadMarmotPushSettings(ME)).customServer).toEqual({
      pubkey: BUILT_IN_SERVERS.preview.pubkey,
      relayHint: 'wss://inbox.example',
    });
    expect(lastRegistration()?.server).toBe(BUILT_IN_SERVERS.preview.pubkey);
    await setMarmotPushServer(null);
    expect((await loadMarmotPushSettings(ME)).customServer).toBeNull();
    expect(lastRegistration()?.server).toBe(BUILT_IN_SERVERS.production.pubkey);
    await expect(setMarmotPushServer('npub1nope')).rejects.toThrow();
  });

  it('a failed token deletion is reported and retried at the next start', async () => {
    await enableMarmotPush(ME);
    (Notifications.unregisterForNotificationsAsync as jest.Mock).mockRejectedValueOnce(
      new Error('offline'),
    );
    expect((await disableMarmotPush(ME)).tokenDeleted).toBe(false);
    expect(await AsyncStorage.getItem('marmot_push_retire_pending_v1')).toBe('1');
    (Notifications.unregisterForNotificationsAsync as jest.Mock).mockClear();
    const stop = startMarmotPushRegistration();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalled();
    expect(await AsyncStorage.getItem('marmot_push_retire_pending_v1')).toBeNull();
    stop();
  });

  it('removing ANOTHER account that had push on deletes the token and re-signs this one', async () => {
    await AsyncStorage.setItem(enabledKey('removed-account'), '1');
    await enableMarmotPush(ME);
    mockSession.pushRegistration.sync.mockClear();
    (Notifications.getDevicePushTokenAsync as jest.Mock).mockResolvedValueOnce({
      type: 'android',
      data: 'fcm-token-2',
    });
    await retireMarmotPushForAccount('removed-account');
    expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalled();
    expect(Notifications.unregisterTaskAsync).not.toHaveBeenCalled();
    expect(lastRegistration()?.token).toEqual(new TextEncoder().encode('fcm-token-2'));
    expect(mockSession.pushRegistration.sync).toHaveBeenCalledWith({ interactive: true });
  });

  it('removing the ACTIVE account waits for the next opted-in account before re-registering', async () => {
    await AsyncStorage.setItem(enabledKey('next-account'), '1');
    const stop = startMarmotPushRegistration();
    await enableMarmotPush(ME);
    (Notifications.getDevicePushTokenAsync as jest.Mock).mockClear();
    await retireMarmotPushForAccount('active-account');
    expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalled();
    // No other account yet: no new token is requested.
    expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    const next = {
      ...mockSession,
      pubkey: 'next-account',
      pushRegistration: { ...mockSession.pushRegistration, sync: jest.fn(async () => null) },
    };
    mockSessionListener?.(next);
    await new Promise((r) => setTimeout(r, 0));
    expect(Notifications.getDevicePushTokenAsync).toHaveBeenCalled();
    expect(next.pushRegistration.sync).toHaveBeenCalledWith({ interactive: true });
    stop();
  });
});

describe('ordering of device-level changes', () => {
  it('a slow startup token read cannot undo a later disable', async () => {
    await AsyncStorage.setItem(enabledKey(ME), '1');
    let release!: (v: unknown) => void;
    (Notifications.getDevicePushTokenAsync as jest.Mock).mockImplementationOnce(
      () => new Promise((r) => (release = r)),
    );
    const stop = startMarmotPushRegistration();
    await new Promise((r) => setTimeout(r, 0));
    const disabled = disableMarmotPush(ME);
    release({ type: 'android', data: 'late-token' });
    await disabled;
    expect(lastRegistration()).toBeNull();
    expect((await loadMarmotPushSettings(ME)).enabled).toBe(false);
    stop();
  });

  it('account removal before settings are restored still deletes the token', async () => {
    await AsyncStorage.setItem(enabledKey('removed-account'), '1');
    expect(await retireMarmotPushForAccount('removed-account')).toBe(true);
    expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalled();
  });

  it('a failed deletion on account removal hands out no replacement token', async () => {
    await AsyncStorage.setItem(enabledKey('removed-account'), '1');
    await enableMarmotPush(ME);
    (Notifications.getDevicePushTokenAsync as jest.Mock).mockClear();
    (Notifications.unregisterForNotificationsAsync as jest.Mock).mockRejectedValueOnce(
      new Error('offline'),
    );
    expect(await retireMarmotPushForAccount('removed-account')).toBe(false);
    expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('marmot_push_retire_pending_v1')).toBe('1');
  });

  it('enabling first finishes an owed token deletion — never publishes a token still owed', async () => {
    await AsyncStorage.setItem('marmot_push_retire_pending_v1', '1');
    (Notifications.unregisterForNotificationsAsync as jest.Mock).mockRejectedValueOnce(
      new Error('offline'),
    );
    expect((await enableMarmotPush(ME)).status).toBe('unavailable');
    expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('marmot_push_retire_pending_v1')).toBe('1');
    // Online again: the deletion completes, then a fresh token is handed out.
    expect((await enableMarmotPush(ME)).status).toBe('enabled');
    expect(await AsyncStorage.getItem('marmot_push_retire_pending_v1')).toBeNull();
  });

  it('a token that arrives after a failed startup read is still taken', async () => {
    await AsyncStorage.setItem(enabledKey(ME), '1');
    (Notifications.getDevicePushTokenAsync as jest.Mock).mockRejectedValueOnce(
      new Error('timed out'),
    );
    const stop = startMarmotPushRegistration();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(lastRegistration()).toBeNull();
    expect(await pendingMarmotPushGroups(ME)).toBeNull(); // shown as "not set up yet"
    const listener = (Notifications.addPushTokenListener as jest.Mock).mock.calls.at(-1)?.[0];
    listener({ type: 'android', data: 'late-token' });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(lastRegistration()?.token).toEqual(new TextEncoder().encode('late-token'));
    stop();
  });
});

describe('native token reads', () => {
  it('a transient failure can be retried (no cached rejection)', async () => {
    (Notifications.getDevicePushTokenAsync as jest.Mock).mockRejectedValueOnce(
      new Error('SERVICE_NOT_AVAILABLE'),
    );
    expect((await enableMarmotPush(ME)).status).toBe('unavailable');
    expect((await enableMarmotPush(ME)).status).toBe('enabled');
    expect(Notifications.getDevicePushTokenAsync).toHaveBeenCalledTimes(2);
  });

  it('Finish setup retries a token read that failed at startup', async () => {
    await AsyncStorage.setItem(enabledKey(ME), '1');
    (Notifications.getDevicePushTokenAsync as jest.Mock).mockRejectedValueOnce(
      new Error('offline'),
    );
    const stop = startMarmotPushRegistration();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(await pendingMarmotPushGroups(ME)).toBeNull();
    expect(await syncMarmotPushNow(ME)).toMatchObject({ published: 2 });
    expect(lastRegistration()).not.toBeNull();
    stop();
  });

  it('disabling still retracts and revokes when the setting cannot be saved', async () => {
    await enableMarmotPush(ME);
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    const off = await disableMarmotPush(ME);
    expect(off.saved).toBe(false);
    expect(lastRegistration()).toBeNull();
    expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalled();
  });

  it('re-enable fails (retryably) when a stale deletion marker cannot be cleared', async () => {
    await AsyncStorage.setItem('marmot_push_retire_pending_v1', '1');
    (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error('locked'));
    expect((await enableMarmotPush(ME)).status).toBe('unavailable');
    expect((await enableMarmotPush(ME)).status).toBe('enabled');
  });

  it('a failed enable write leaves push off — even with a token callback in flight', async () => {
    const stop = startMarmotPushRegistration();
    await new Promise((r) => setTimeout(r, 0));
    mockSession.pushRegistration.setRegistration.mockClear();
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    expect((await enableMarmotPush(ME)).status).toBe('unavailable');
    const listener = (Notifications.addPushTokenListener as jest.Mock).mock.calls.at(-1)?.[0];
    listener({ type: 'android', data: 'fcm-token-1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSession.pushRegistration.setRegistration).not.toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'fcm' }),
    );
    stop();
  });

  it('a slow status read cannot resurrect "on" after a disable', async () => {
    await AsyncStorage.setItem(enabledKey(ME), '1');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const realGet = (AsyncStorage.getItem as jest.Mock).getMockImplementation();
    (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(async (k: string) => {
      await gate;
      return realGet?.(k) ?? '1';
    });
    const status = pendingMarmotPushGroups(ME); // starts the (slow) hydration
    const off = disableMarmotPush(ME);
    release();
    await Promise.all([status, off]);
    expect((await loadMarmotPushSettings(ME)).enabled).toBe(false);
    expect(await pendingMarmotPushGroups(ME)).toBe(0);
    expect(await syncMarmotPushNow(ME)).toMatchObject({ published: 2 });
    expect(lastRegistration()).toBeNull();
  });
});

describe('per-account opt-in (two accounts on one phone stay unlinkable)', () => {
  it('a newly activated account never inherits push — it gets a retraction, not the token', async () => {
    const stop = startMarmotPushRegistration();
    await flush();
    await enableMarmotPush(ME);
    expect(lastRegistration()).not.toBeNull();
    const child = sessionFor('child-account');
    mockActive = child;
    mockSessionListener?.(child);
    await flush();
    expect(child.pushRegistration.setRegistration).toHaveBeenCalledWith(null);
    expect(child.pushRegistration.setRegistration).not.toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'fcm' }),
    );
    expect(child.pushRegistration.sync).not.toHaveBeenCalled();
    expect((await loadMarmotPushSettings('child-account')).enabled).toBe(false);
    stop();
  });

  it('a token rotation reaches only the accounts that opted in', async () => {
    const stop = startMarmotPushRegistration();
    await flush();
    await enableMarmotPush(ME);
    const child = sessionFor('child-account');
    mockActive = child;
    mockSessionListener?.(child);
    await flush();
    const listener = (Notifications.addPushTokenListener as jest.Mock).mock.calls.at(-1)?.[0];
    listener({ type: 'android', data: 'rotated-token' });
    await flush();
    expect(child.pushRegistration.setRegistration).not.toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'fcm' }),
    );
    stop();
  });

  it('settings are per account; the other one is told the phone is shared', async () => {
    await enableMarmotPush(ME);
    expect(await loadMarmotPushSettings(ME)).toMatchObject({ enabled: true, otherAccounts: false });
    expect(await loadMarmotPushSettings('child-account')).toMatchObject({
      enabled: false,
      otherAccounts: true,
    });
    expect(await AsyncStorage.getItem(enabledKey(ME))).toBe('1');
    expect(await AsyncStorage.getItem(enabledKey('child-account'))).toBeNull();
  });

  it('enabling while another account is running does not touch its groups', async () => {
    const child = sessionFor('child-account');
    mockActive = child;
    const outcome = await enableMarmotPush(ME);
    expect(outcome).toEqual({ status: 'enabled', sync: null });
    expect(child.pushRegistration.setRegistration).not.toHaveBeenCalled();
    expect(child.pushRegistration.sync).not.toHaveBeenCalled();
  });

  it('turning push off with a declined retraction replaces the token the other account uses', async () => {
    await AsyncStorage.setItem(enabledKey('parent-account'), '1');
    await enableMarmotPush(ME);
    mockSession.pushRegistration.sync.mockResolvedValueOnce({
      published: 0,
      removed: 0,
      pending: 3,
      declined: true,
    });
    (Notifications.getDevicePushTokenAsync as jest.Mock).mockResolvedValueOnce({
      type: 'android',
      data: 'fcm-token-2',
    });
    expect((await disableMarmotPush(ME)).tokenDeleted).toBe(true);
    expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalled();
    expect(Notifications.unregisterTaskAsync).not.toHaveBeenCalled();
    const parent = sessionFor('parent-account');
    mockActive = parent;
    await syncMarmotPushNow('parent-account');
    expect(parent.pushRegistration.setRegistration).toHaveBeenLastCalledWith(
      expect.objectContaining({ token: new TextEncoder().encode('fcm-token-2') }),
    );
  });

  it('turning push off while the watcher may still hold the token replaces it for the other account', async () => {
    await AsyncStorage.setItem(enabledKey('parent-account'), '1');
    await enableMarmotPush(ME);
    expect((await disableMarmotPush(ME, { stillRegistered: true })).tokenDeleted).toBe(true);
    expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalled();
    expect(Notifications.unregisterTaskAsync).not.toHaveBeenCalled();
  });

  it('turning push off for one account keeps the token for another that still uses it', async () => {
    await AsyncStorage.setItem(enabledKey('parent-account'), '1');
    await enableMarmotPush(ME);
    const off = await disableMarmotPush(ME);
    expect(off.tokenDeleted).toBe(true);
    expect(lastRegistration()).toBeNull(); // this account's groups retract
    expect(Notifications.unregisterForNotificationsAsync).not.toHaveBeenCalled();
    expect(Notifications.unregisterTaskAsync).not.toHaveBeenCalled();
    // The parent's session still gets the token.
    const parent = sessionFor('parent-account');
    mockActive = parent;
    expect(await syncMarmotPushNow('parent-account')).toMatchObject({ published: 1 });
    expect(parent.pushRegistration.setRegistration).toHaveBeenLastCalledWith(
      expect.objectContaining({ platform: 'fcm' }),
    );
  });

  it('removing the only opted-in account fetches no new token for the remaining one', async () => {
    await enableMarmotPush(ME);
    (Notifications.getDevicePushTokenAsync as jest.Mock).mockClear();
    const child = sessionFor('child-account');
    mockActive = child;
    expect(await retireMarmotPushForAccount(ME)).toBe(true);
    expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalled();
    expect(Notifications.unregisterTaskAsync).toHaveBeenCalledWith('lp-marmot-push-wake');
    expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(child.pushRegistration.setRegistration).not.toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'fcm' }),
    );
    // A re-login of the removed account starts with push off.
    expect(await AsyncStorage.getItem(enabledKey(ME))).toBeNull();
  });

  it('removing an account that never had push on leaves the token alone', async () => {
    await enableMarmotPush(ME);
    expect(await retireMarmotPushForAccount('child-account')).toBe(true);
    expect(Notifications.unregisterForNotificationsAsync).not.toHaveBeenCalled();
  });

  it('migrates the old device-wide switch to the active account only', async () => {
    await AsyncStorage.setItem('marmot_push_enabled_v1', '1');
    expect(await loadMarmotPushSettings(ME)).toMatchObject({ enabled: true, otherAccounts: false });
    expect(await loadMarmotPushSettings('child-account')).toMatchObject({ enabled: false });
    expect(await AsyncStorage.getItem('marmot_push_enabled_v1')).toBeNull();
    expect(await AsyncStorage.getItem(enabledKey(ME))).toBe('1');
  });

  it('removing an account that turned push off still deletes the token another account uses', async () => {
    // Its retraction may have been declined or never run: the token could
    // still be in its groups, and its signer is gone.
    await AsyncStorage.setItem(enabledKey('parent-account'), '1');
    await AsyncStorage.setItem(enabledKey('child-account'), '0');
    const parent = sessionFor('parent-account');
    mockActive = parent;
    (Notifications.getDevicePushTokenAsync as jest.Mock).mockResolvedValueOnce({
      type: 'android',
      data: 'fcm-token-2',
    });
    expect(await retireMarmotPushForAccount('child-account')).toBe(true);
    expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalled();
    expect(parent.pushRegistration.setRegistration).toHaveBeenLastCalledWith(
      expect.objectContaining({ token: new TextEncoder().encode('fcm-token-2') }),
    );
    expect(parent.pushRegistration.sync).toHaveBeenCalledWith({ interactive: true });
    expect(await AsyncStorage.getItem(enabledKey('child-account'))).toBeNull();
  });

  it('an opt-in that cannot be removed is tombstoned, so a later re-login stays off', async () => {
    await enableMarmotPush(ME);
    (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error('locked'));
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('locked'));
    expect(await retireMarmotPushForAccount(ME)).toBe(true);
    expect(await AsyncStorage.getItem(enabledKey(ME))).toBe('1'); // stuck
    expect(JSON.parse(mockSecure.get('marmot_push_forgotten_v1') ?? '[]')).toEqual([ME]);
    // Restart: the tombstone wins, and the stuck key is cleaned up.
    __resetMarmotPushForTests();
    expect(await loadMarmotPushSettings(ME)).toMatchObject({ enabled: false });
    expect(await AsyncStorage.getItem(enabledKey(ME))).toBeNull();
    expect(mockSecure.has('marmot_push_forgotten_v1')).toBe(false);
  });

  it('opting in again clears the tombstone; nothing writable is reported', async () => {
    mockSecure.set('marmot_push_forgotten_v1', JSON.stringify([ME]));
    expect((await enableMarmotPush(ME)).status).toBe('enabled');
    expect(mockSecure.has('marmot_push_forgotten_v1')).toBe(false);
    __resetMarmotPushForTests();
    expect(await loadMarmotPushSettings(ME)).toMatchObject({ enabled: true });
    // Neither store writable: reported.
    const SecureStore = jest.requireMock('expo-secure-store');
    (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error('locked'));
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('locked'));
    SecureStore.setItemAsync.mockRejectedValueOnce(new Error('locked'));
    expect(await retireMarmotPushForAccount(ME)).toBe(false);
  });

  it('a failed re-enable keeps the tombstone protecting a stuck opt-in', async () => {
    await AsyncStorage.setItem(enabledKey(ME), '1'); // stuck from a failed removal
    mockSecure.set('marmot_push_forgotten_v1', JSON.stringify([ME]));
    (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error('locked')); // still stuck
    expect(await loadMarmotPushSettings(ME)).toMatchObject({ enabled: false });
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    expect((await enableMarmotPush(ME)).status).toBe('unavailable');
    expect(JSON.parse(mockSecure.get('marmot_push_forgotten_v1') ?? '[]')).toEqual([ME]);
    // Written, but the tombstone can't be lifted: the opt-in is reverted.
    const SecureStore = jest.requireMock('expo-secure-store');
    SecureStore.deleteItemAsync.mockRejectedValueOnce(new Error('locked'));
    expect((await enableMarmotPush(ME)).status).toBe('unavailable');
    expect(await AsyncStorage.getItem(enabledKey(ME))).toBe('0');
  });

  it('turning push off mid account-switch counts as unfinished — the token is replaced', async () => {
    await AsyncStorage.setItem(enabledKey('parent-account'), '1');
    await enableMarmotPush(ME);
    mockSession.pushRegistration.holdsRecords.mockResolvedValueOnce(true); // a group not reached
    expect((await disableMarmotPush(ME)).tokenDeleted).toBe(true);
    expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalled();
  });

  it('the old device-wide switch never overrides a per-account choice already recorded', async () => {
    await AsyncStorage.setItem('marmot_push_enabled_v1', '1');
    await AsyncStorage.setItem(enabledKey(ME), '0'); // turned off since
    expect(await loadMarmotPushSettings(ME)).toMatchObject({ enabled: false });
    expect(await AsyncStorage.getItem(enabledKey(ME))).toBe('0');
    expect(await AsyncStorage.getItem('marmot_push_enabled_v1')).toBeNull();
  });

  it('concurrent first reads migrate the old switch once, to one account', async () => {
    await AsyncStorage.setItem('marmot_push_enabled_v1', '1');
    const first = loadMarmotPushSettings(ME);
    mockActivePubkey = 'child-account'; // switched while the read is in flight
    const second = loadMarmotPushSettings('child-account');
    await Promise.all([first, second]);
    expect(await AsyncStorage.getItem(enabledKey(ME))).toBe('1');
    expect(await AsyncStorage.getItem(enabledKey('child-account'))).toBeNull();
  });

  it('an old device-wide switch with no known owner yet touches nothing', async () => {
    await AsyncStorage.setItem('marmot_push_enabled_v1', '1');
    mockActivePubkey = null;
    mockActive = null;
    await expect(loadMarmotPushSettings(ME)).rejects.toThrow();
    expect(await AsyncStorage.getItem('marmot_push_enabled_v1')).toBe('1');
  });
});

describe('the device token, shared with the notification watcher', () => {
  it('is exposed raw (FCM string) and announced on enable, change-free re-reads and disable', async () => {
    const seen: unknown[] = [];
    const unsubscribe = subscribePushDevice(() => seen.push(currentPushDevice(ME)));
    expect(currentPushDevice(ME)).toBeUndefined();
    await enableMarmotPush(ME);
    expect(currentPushDevice(ME)).toEqual({ platform: 'fcm', token: 'fcm-token-1' });
    // Same token again (Finish setup): no new announcement.
    await syncMarmotPushNow(ME);
    await disableMarmotPush(ME);
    expect(currentPushDevice(ME)).toBeNull();
    expect(seen).toEqual([{ platform: 'fcm', token: 'fcm-token-1' }, null]);
    unsubscribe();
  });

  it('APNs tokens come back as lowercase hex', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' });
    try {
      (Notifications.getDevicePushTokenAsync as jest.Mock).mockResolvedValueOnce({
        type: 'ios',
        data: 'AB'.repeat(32),
      });
      await enableMarmotPush(ME);
      expect(currentPushDevice(ME)).toEqual({ platform: 'apns', token: 'ab'.repeat(32) });
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
    }
  });

  it('is account-scoped: another account never gets it; turning one off is announced', async () => {
    await AsyncStorage.setItem(enabledKey('parent-account'), '1');
    await enableMarmotPush(ME);
    expect(currentPushDevice('child-account')).toBeNull();
    expect(currentPushDevice(null)).toBeNull();
    expect(currentPushDevice('parent-account')).toEqual({ platform: 'fcm', token: 'fcm-token-1' });
    const seen: unknown[] = [];
    const unsubscribe = subscribePushDevice(() => seen.push(currentPushDevice(ME)));
    await disableMarmotPush(ME); // the parent keeps the token
    expect(seen).toEqual([null]);
    expect(currentPushDevice('parent-account')).not.toBeNull();
    unsubscribe();
  });
});
