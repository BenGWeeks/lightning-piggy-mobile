import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  beginDefaultSetup,
  isDefaultSetupCurrent,
  noteManualNotificationChange,
} from './notificationDefaultsTask';
import {
  disableMarmotPush,
  enableMarmotPush,
  loadMarmotPushSettings,
  currentPushDevice,
  __resetMarmotPushForTests,
} from './marmotPushRegistration';

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

jest.mock('./marmotSession', () => ({
  getMarmotSession: () => mockActive,
  subscribeMarmotSession: (l: (s: unknown) => void) => {
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
jest.mock('./walletStorageService', () => ({
  getActivePubkey: () => mockActivePubkey,
  subscribeActivePubkey: () => () => undefined,
}));
jest.mock('./notificationService', () => ({
  requestNotificationPermission: jest.fn(async () => true),
}));
const mockInboxRelays = jest.fn(async (_pubkey: string) => ['wss://inbox.example']);
jest.mock('./marmotNetwork', () => ({
  createPushTransport: () => ({ inboxRelays: (pubkey: string) => mockInboxRelays(pubkey) }),
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

const ME = 'active-account';
const enabledKey = (pubkey: string) => `marmot_push_enabled_v1_${pubkey}`;
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

// The wake task is Android-only (iOS shows the server's alert itself).
beforeAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
});

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockInboxRelays.mockReset().mockResolvedValue(['wss://inbox.example']);
  __resetMarmotPushForTests();
  mockActive = mockSession;
  mockActivePubkey = ME;
  mockSecure.clear();
});

it('preserves the legacy device-wide OFF preference during migration', async () => {
  await AsyncStorage.setItem('marmot_push_enabled_v1', '0');
  expect(await loadMarmotPushSettings(ME)).toMatchObject({ enabled: false });
  expect(await AsyncStorage.getItem(enabledKey(ME))).toBe('0');
});

it('schedules default group records without an interactive signer batch', async () => {
  expect(await enableMarmotPush(ME, { interactive: false })).toEqual({
    status: 'enabled',
    sync: null,
  });
  expect(mockSession.pushRegistration.sync).not.toHaveBeenCalled();
  expect(mockSession.pushRegistration.schedule).toHaveBeenCalled();
});

it.each(['switch', 'sign-out'])(
  'cancels automatic enablement during token acquisition on %s',
  async (action) => {
    let active = true;
    let release!: (v: unknown) => void;
    let tokenStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      tokenStarted = resolve;
    });
    (Notifications.getDevicePushTokenAsync as jest.Mock).mockImplementationOnce(() => {
      tokenStarted();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const enabling = enableMarmotPush(ME, { interactive: false, stillActive: () => active });
    await started;
    active = false;
    mockActive = action === 'switch' ? sessionFor('other-account') : null;
    mockActivePubkey = mockActive?.pubkey ?? null;
    await AsyncStorage.multiRemove([enabledKey(ME), `notification_preference_explicit_v1_${ME}`]);
    release({ type: 'android', data: 'late-token' });
    expect(await enabling).toEqual({ status: 'unavailable' });
    expect(await AsyncStorage.getItem(enabledKey(ME))).toBeNull();
    expect(await AsyncStorage.getItem(`notification_preference_explicit_v1_${ME}`)).toBeNull();
    expect(currentPushDevice(ME)).toBeNull();
    expect(Notifications.registerTaskAsync).not.toHaveBeenCalled();
    expect(mockSession.pushRegistration.setRegistration).not.toHaveBeenCalled();
  },
);

it('leaves the automatic decision to the caller after successful push enablement', async () => {
  expect((await enableMarmotPush(ME, { interactive: false })).status).toBe('enabled');
  expect(await AsyncStorage.getItem(enabledKey(ME))).toBe('1');
  expect(await AsyncStorage.getItem(`notification_preference_explicit_v1_${ME}`)).toBeNull();
});

it('leaves automatic setup retryable after a failed push preference write', async () => {
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
  expect((await enableMarmotPush(ME, { interactive: false })).status).toBe('unavailable');
  expect(await AsyncStorage.getItem(enabledKey(ME))).toBeNull();
  expect(await AsyncStorage.getItem(`notification_preference_explicit_v1_${ME}`)).toBeNull();
  expect((await enableMarmotPush(ME, { interactive: false })).status).toBe('enabled');
  expect(await AsyncStorage.getItem(enabledKey(ME))).toBe('1');
  expect(await AsyncStorage.getItem(`notification_preference_explicit_v1_${ME}`)).toBeNull();
});

// --- automatic default setup: one cancellable task per account ---------------------

it.each(['read', 'write'] as const)(
  'leaves automatic setup absent and retryable after a failed forgotten-account %s',
  async (operation) => {
    // Fail inside enableNow, after hydration and the opt-in write succeeded.
    await loadMarmotPushSettings(ME);
    mockSecure.set('marmot_push_forgotten_v1', JSON.stringify([ME]));
    const secure = jest.requireMock('expo-secure-store');
    const storageOperation = operation === 'read' ? secure.getItemAsync : secure.deleteItemAsync;
    storageOperation.mockRejectedValueOnce(new Error('storage unavailable'));

    expect(await enableMarmotPush(ME, { interactive: false })).toEqual({
      status: 'unavailable',
    });
    expect(await AsyncStorage.getItem(enabledKey(ME))).toBeNull();
    expect(await AsyncStorage.getItem(`notification_preference_explicit_v1_${ME}`)).toBeNull();
    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(enabledKey(ME), '0');
    expect(currentPushDevice(ME)).toBeNull();
    expect(Notifications.registerTaskAsync).not.toHaveBeenCalled();
    expect(mockSession.pushRegistration.setRegistration).not.toHaveBeenCalled();

    expect((await enableMarmotPush(ME, { interactive: false })).status).toBe('enabled');
    expect(await AsyncStorage.getItem(enabledKey(ME))).toBe('1');
    expect(mockSecure.has('marmot_push_forgotten_v1')).toBe(false);
  },
);

it('records a user push toggle as a manual change before anything is awaited', async () => {
  const automatic = beginDefaultSetup(ME);
  const enabling = enableMarmotPush(ME);
  expect(isDefaultSetupCurrent(automatic)).toBe(false); // synchronously — no await yet
  await enabling;
  const next = beginDefaultSetup(ME);
  const disabling = disableMarmotPush(ME);
  expect(isDefaultSetupCurrent(next)).toBe(false);
  await disabling;
  // Automatic enablement is not a user choice.
  const last = beginDefaultSetup(ME);
  await enableMarmotPush(ME, { interactive: false });
  expect(isDefaultSetupCurrent(last)).toBe(true);
});

it('fetches no token for an automatic run that went stale before the token read', async () => {
  let checks = 0;
  const outcome = await enableMarmotPush(ME, {
    interactive: false,
    stillActive: () => ++checks <= 1, // current when queued, stale once it runs
  });
  expect(outcome).toEqual({ status: 'unavailable' });
  expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(enabledKey(ME))).toBeNull();
});

it.each(['switch', 'sign-out'])(
  'commits nothing when %s lands while the automatic opt-in is being persisted',
  async (action) => {
    let active = true;
    let release!: () => void;
    let writing!: () => void;
    const started = new Promise<void>((resolve) => {
      writing = resolve;
    });
    const setItem = AsyncStorage.setItem as jest.Mock;
    const original = setItem.getMockImplementation()!;
    setItem.mockImplementationOnce(async (key: string, value: string) => {
      writing();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return original(key, value);
    });
    const enabling = enableMarmotPush(ME, { interactive: false, stillActive: () => active });
    await started;
    // The account changes while the write is in flight.
    active = false;
    mockActive = action === 'switch' ? sessionFor('other-account') : null;
    mockActivePubkey = mockActive?.pubkey ?? null;
    release();
    expect(await enabling).toEqual({ status: 'unavailable' });
    // The automatic write is taken back; nothing is committed at runtime.
    expect(await AsyncStorage.getItem(enabledKey(ME))).toBeNull();
    expect((await loadMarmotPushSettings(ME)).enabled).toBe(false);
    expect(currentPushDevice(ME)).toBeNull();
    expect(currentPushDevice('other-account')).toBeNull();
    expect(Notifications.registerTaskAsync).not.toHaveBeenCalled();
    expect(mockSession.pushRegistration.setRegistration).not.toHaveBeenCalled();
    if (mockActive) expect(mockActive.pushRegistration.setRegistration).not.toHaveBeenCalled();
  },
);

it.each(['forgotten read', 'forgotten write', 'wake task'] as const)(
  'rolls back stale automatic enablement during %s',
  async (window) => {
    // Hydrate first so the blocked operation belongs to enableNow, not startup.
    await loadMarmotPushSettings(ME);
    mockSecure.set('marmot_push_forgotten_v1', JSON.stringify([ME]));
    const SecureStore = jest.requireMock('expo-secure-store');
    const operation =
      window === 'forgotten read'
        ? SecureStore.getItemAsync
        : window === 'forgotten write'
          ? SecureStore.deleteItemAsync
          : Notifications.registerTaskAsync;
    const original = operation.getMockImplementation()!;
    let release!: () => void;
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    operation.mockImplementationOnce(async (...args: unknown[]) => {
      enter();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return original(...args);
    });
    const task = beginDefaultSetup(ME);
    const enabling = enableMarmotPush(ME, {
      interactive: false,
      stillActive: () => isDefaultSetupCurrent(task),
    });
    await entered;
    // Switching accounts while this await is pending invalidates the live guard.
    const other = sessionFor('other-account');
    mockActive = other;
    mockActivePubkey = other.pubkey;
    release();
    expect(await enabling).toEqual({ status: 'unavailable' });
    expect(await AsyncStorage.getItem(enabledKey(ME))).toBeNull();
    expect((await loadMarmotPushSettings(ME)).enabled).toBe(false);
    expect(currentPushDevice(ME)).toBeNull();
    expect(mockSession.pushRegistration.setRegistration).not.toHaveBeenCalled();
    expect(other.pushRegistration.setRegistration).not.toHaveBeenCalled();
    expect(mockSession.pushRegistration.schedule).not.toHaveBeenCalled();
    if (window === 'forgotten read') {
      expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    }
    if (window === 'wake task') {
      expect(Notifications.unregisterTaskAsync).toHaveBeenCalledWith('lp-marmot-push-wake');
    } else {
      expect(Notifications.registerTaskAsync).not.toHaveBeenCalled();
    }
  },
);

it.each(['forgotten storage', 'wake task'] as const)(
  'honours a manual choice during automatic %s',
  async (window) => {
    await loadMarmotPushSettings(ME);
    const operation =
      window === 'forgotten storage'
        ? jest.requireMock('expo-secure-store').getItemAsync
        : Notifications.registerTaskAsync;
    const original = operation.getMockImplementation()!;
    let release!: () => void;
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    operation.mockImplementationOnce(async (...args: unknown[]) => {
      enter();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return original(...args);
    });
    const task = beginDefaultSetup(ME);
    const enabling = enableMarmotPush(ME, {
      interactive: false,
      stillActive: () => isDefaultSetupCurrent(task),
    });
    await entered;
    noteManualNotificationChange();
    release();
    expect(await enabling).toEqual({ status: 'unavailable' });
    expect(await AsyncStorage.getItem(enabledKey(ME))).toBeNull();
    expect((await loadMarmotPushSettings(ME)).enabled).toBe(false);
    expect(currentPushDevice(ME)).toBeNull();
    expect(mockSession.pushRegistration.setRegistration).not.toHaveBeenCalled();
    expect(mockSession.pushRegistration.schedule).not.toHaveBeenCalled();
    if (window === 'wake task') {
      expect(Notifications.unregisterTaskAsync).toHaveBeenCalledWith('lp-marmot-push-wake');
    } else {
      expect(Notifications.registerTaskAsync).not.toHaveBeenCalled();
    }
  },
);
