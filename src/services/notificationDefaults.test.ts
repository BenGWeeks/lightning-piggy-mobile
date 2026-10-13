import * as Notifications from 'expo-notifications';
import { requestNotificationPermission } from './notificationService';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { initialiseNotificationDefaults } from './notificationDefaults';
import { enableMarmotPush } from './marmotPushRegistration';
import { loadWatcherState, saveWatcherState } from './watcherPushStore';
import { scheduleWatcherReconciliation } from './watcherPush';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  AndroidImportance: { HIGH: 4, LOW: 2 },
  AndroidNotificationVisibility: { PRIVATE: 0, PUBLIC: 1 },
}));

jest.mock('./notificationService', () => ({
  ...jest.requireActual('./notificationService'),
  requestNotificationPermission: jest.fn(
    jest.requireActual('./notificationService').requestNotificationPermission,
  ),
}));

jest.mock('./watcherPush', () => ({ scheduleWatcherReconciliation: jest.fn() }));

jest.mock('./marmotPushRegistration', () => ({
  loadMarmotPushSettings: jest.fn(async () => ({ enabled: false })),
  enableMarmotPush: jest.fn(),
}));
jest.mock('./watcherRegistration', () => ({
  NO_CATEGORIES: { dm: false, zap: false, mention: false, payment: false },
  WATCHER_CATEGORIES: ['dm', 'zap', 'mention', 'payment'],
  anyCategory: (c: Record<string, boolean>) => Object.values(c).some(Boolean),
}));

const me = 'first';
const pushKey = `marmot_push_enabled_v1_${me}`;
const watcherKey = `watcher_push_v1_${me}`;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  (enableMarmotPush as jest.Mock).mockImplementation(async (pubkey: string) => {
    await AsyncStorage.setItem(`marmot_push_enabled_v1_${pubkey}`, '1');
    return { status: 'enabled', sync: null };
  });
});

it('enables the first account once, without interactive signer work', async () => {
  await initialiseNotificationDefaults(me, () => true);
  expect(enableMarmotPush).toHaveBeenCalledWith(me, {
    interactive: false,
    stillActive: expect.any(Function),
  });
  expect((await loadWatcherState(me)).categories).toEqual({
    dm: true,
    zap: true,
    mention: true,
    payment: true,
  });
  await initialiseNotificationDefaults(me, () => true);
  expect(enableMarmotPush).toHaveBeenCalledTimes(1);
});

it('does not enable a second account when another account stored OFF', async () => {
  await AsyncStorage.setItem('marmot_push_enabled_v1_other', '0');
  await initialiseNotificationDefaults(me, () => true);
  expect(enableMarmotPush).not.toHaveBeenCalled();
  expect((await loadWatcherState(me)).categories.dm).toBe(false);
  expect(await AsyncStorage.getItem(pushKey)).toBe('0');
});

it('preserves explicit watcher OFF while enabling missing Instant alerts', async () => {
  await saveWatcherState(me, {
    categories: { dm: false, zap: false, mention: false, payment: false },
    lastTs: 0,
    registered: null,
  });
  const before = await AsyncStorage.getItem(watcherKey);
  await initialiseNotificationDefaults(me, () => true);
  expect(enableMarmotPush).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem(watcherKey)).toBe(before);
});

it('preserves Instant alerts OFF', async () => {
  await AsyncStorage.setItem(pushKey, '0');
  await initialiseNotificationDefaults(me, () => true);
  expect(enableMarmotPush).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(pushKey)).toBe('0');
});

it('makes no decision for an inactive account', async () => {
  await initialiseNotificationDefaults(me, () => false);
  expect(enableMarmotPush).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(pushKey)).toBeNull();
  expect(await AsyncStorage.getItem(watcherKey)).toBeNull();
});

it('preserves an existing enabled install and its individual categories', async () => {
  await AsyncStorage.setItem(pushKey, '1');
  await saveWatcherState(me, {
    categories: { dm: true, zap: false, mention: true, payment: false },
    lastTs: 20,
    registered: null,
  });
  const before = await AsyncStorage.getItem(watcherKey);
  await initialiseNotificationDefaults(me, () => true);
  expect(enableMarmotPush).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(pushKey)).toBe('1');
  expect(await AsyncStorage.getItem(watcherKey)).toBe(before);
});

it('serialises concurrent first-account decisions so only one phone account defaults on', async () => {
  await Promise.all([
    initialiseNotificationDefaults(me, () => true),
    initialiseNotificationDefaults('second', () => true),
  ]);
  expect(enableMarmotPush).toHaveBeenCalledTimes(1);
  expect((await loadWatcherState('second')).categories).toEqual({
    dm: false,
    zap: false,
    mention: false,
    payment: false,
  });
});

it('reconciles new categories for an already push-enabled account without enabling again', async () => {
  await AsyncStorage.setItem(pushKey, '1');
  await initialiseNotificationDefaults(me, () => true);
  expect(enableMarmotPush).not.toHaveBeenCalled();
  expect((await loadWatcherState(me)).categories).toEqual({
    dm: true,
    zap: true,
    mention: true,
    payment: true,
  });
  expect(scheduleWatcherReconciliation).toHaveBeenCalledWith(me);
});

it.each(['switch', 'sign-out'])(
  'leaves defaults retryable when %s cancels token acquisition',
  async () => {
    let active = true;
    let release!: () => void;
    let started!: () => void;
    const tokenStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    (enableMarmotPush as jest.Mock).mockImplementationOnce(async (_pubkey, { stillActive }) => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { status: stillActive() ? 'enabled' : 'unavailable' };
    });
    const setup = initialiseNotificationDefaults(me, () => active);
    await tokenStarted;
    const pendingPush = await AsyncStorage.getItem(pushKey);
    const pendingDecision = await AsyncStorage.getItem(`notification_preference_explicit_v1_${me}`);
    const pendingWatcher = await AsyncStorage.getItem(watcherKey);
    active = false;
    release();
    await setup;
    expect(pendingPush).toBeNull();
    expect(pendingDecision).toBeNull();
    expect(pendingWatcher).toBeNull();
    expect(await AsyncStorage.getItem(pushKey)).toBeNull();
    expect(await AsyncStorage.getItem(`notification_preference_explicit_v1_${me}`)).toBeNull();
    expect(await AsyncStorage.getItem(watcherKey)).toBeNull();
    expect(scheduleWatcherReconciliation).not.toHaveBeenCalled();
    await initialiseNotificationDefaults(me, () => true);
    expect(await AsyncStorage.getItem(pushKey)).toBe('1');
    expect((await loadWatcherState(me)).categories.dm).toBe(true);
  },
);

it.each(['no-permission', 'unavailable'])('does not commit defaults after %s', async (status) => {
  (enableMarmotPush as jest.Mock).mockResolvedValueOnce({ status });
  await initialiseNotificationDefaults(me, () => true);
  expect(await AsyncStorage.getItem(pushKey)).toBeNull();
  expect(await AsyncStorage.getItem(`notification_preference_explicit_v1_${me}`)).toBeNull();
  expect(await AsyncStorage.getItem(watcherKey)).toBeNull();
  await initialiseNotificationDefaults(me, () => true);
  expect(await AsyncStorage.getItem(pushKey)).toBe('1');
});

it.each(['watcher', 'push-off'])(
  'retries incomplete defaults after a failed %s preference write',
  async (failedPreference) => {
    if (failedPreference === 'push-off') {
      await AsyncStorage.setItem('marmot_push_enabled_v1_other', '0');
    }
    const failedKey = failedPreference === 'watcher' ? watcherKey : pushKey;
    const setItem = AsyncStorage.setItem as jest.Mock;
    const original = setItem.getMockImplementation()!;
    let failNext = true;
    setItem.mockImplementation(async (key: string, value: string) => {
      if (key === failedKey && failNext) {
        failNext = false;
        throw new Error('disk full');
      }
      return original(key, value);
    });
    try {
      await expect(initialiseNotificationDefaults(me, () => true)).rejects.toThrow('disk full');
      expect(await AsyncStorage.getItem(`notification_preference_explicit_v1_${me}`)).toBeNull();
      expect(await AsyncStorage.getItem(failedKey)).toBeNull();
      // Other writes already landed; a later launch must fill the missing preference.
      expect(
        await AsyncStorage.getItem(failedPreference === 'watcher' ? pushKey : watcherKey),
      ).not.toBeNull();
      await initialiseNotificationDefaults(me, () => true);
      const enabled = failedPreference === 'watcher';
      expect(await AsyncStorage.getItem(pushKey)).toBe(enabled ? '1' : '0');
      expect((await loadWatcherState(me)).categories).toEqual({
        dm: enabled,
        zap: enabled,
        mention: enabled,
        payment: enabled,
      });
      expect(
        await AsyncStorage.getItem(`notification_preference_explicit_v1_${me}`),
      ).not.toBeNull();
      expect(enableMarmotPush).toHaveBeenCalledTimes(enabled ? 1 : 0);
    } finally {
      setItem.mockImplementation(original);
    }
  },
);

// The foreground permission helper asks an undetermined OS permission even
// when no automatic push enablement is needed.
it.each(['decision', 'both-preferences', 'instant-off', 'additional-account'])(
  'requests OS permission independently of saved %s choices',
  async (scenario) => {
    if (scenario === 'decision') {
      await AsyncStorage.setItem(`notification_preference_explicit_v1_${me}`, '1');
    } else if (scenario === 'both-preferences') {
      await AsyncStorage.setItem(pushKey, '0');
      await saveWatcherState(me, {
        categories: { dm: false, zap: false, mention: false, payment: false },
        lastTs: 0,
        registered: null,
      });
    } else {
      await AsyncStorage.setItem(
        scenario === 'instant-off' ? pushKey : 'marmot_push_enabled_v1_other',
        '0',
      );
    }
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      granted: false,
      status: 'undetermined',
      canAskAgain: true,
    });
    await initialiseNotificationDefaults(me, () => true);
    expect(requestNotificationPermission).toHaveBeenCalledTimes(1);
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(enableMarmotPush).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(pushKey)).not.toBe('1');
  },
);

it.each(['watcher', 'push-off'])(
  'skips subsequent writes when account cancellation occurs during %s persistence',
  async (stage) => {
    await AsyncStorage.setItem('marmot_push_enabled_v1_other', '0');
    let active = true;
    const setItem = AsyncStorage.setItem as jest.Mock;
    const original = setItem.getMockImplementation()!;
    setItem.mockImplementation(async (key: string, value: string) => {
      await original(key, value);
      if (key === (stage === 'watcher' ? watcherKey : pushKey)) active = false;
    });
    try {
      await initialiseNotificationDefaults(me, () => active);
      expect(await AsyncStorage.getItem(`notification_preference_explicit_v1_${me}`)).toBeNull();
      if (stage === 'watcher') {
        expect(await AsyncStorage.getItem(pushKey)).toBeNull();
        expect(scheduleWatcherReconciliation).not.toHaveBeenCalled();
      }
    } finally {
      setItem.mockImplementation(original);
    }
  },
);
