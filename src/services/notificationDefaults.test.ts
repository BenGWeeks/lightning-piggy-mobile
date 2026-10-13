import * as Notifications from 'expo-notifications';
import { requestNotificationPermission } from './notificationService';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { initialiseNotificationDefaults } from './notificationDefaults';
import { noteManualNotificationChange } from './notificationDefaultsTask';
import { enableMarmotPush } from './marmotPushRegistration';
import { setActivePubkeyForWalletStorage } from './walletStorageService';
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
const decisionKey = `notification_preference_explicit_v1_${me}`;
const setItem = AsyncStorage.setItem as jest.Mock;
let originalSetItem: (key: string, value: string) => Promise<void>;

/** Pause the next write of `key`: resolves `paused` when it starts, lands it on `release()`. */
const pauseWrite = (key: string) => {
  let release!: () => void;
  let started!: () => void;
  const paused = new Promise<void>((resolve) => {
    started = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pending = true;
  setItem.mockImplementation(async (k: string, v: string) => {
    if (k === key && pending) {
      pending = false;
      started();
      await resume;
    }
    return originalSetItem(k, v);
  });
  return { paused, release: () => release() };
};

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  originalSetItem = setItem.getMockImplementation()!;
  setActivePubkeyForWalletStorage(me);
  (enableMarmotPush as jest.Mock).mockImplementation(async (pubkey: string) => {
    await AsyncStorage.setItem(`marmot_push_enabled_v1_${pubkey}`, '1');
    return { status: 'enabled', sync: null };
  });
});
afterEach(() => setItem.mockImplementation(originalSetItem));

it('enables the first account once, without interactive signer work', async () => {
  await initialiseNotificationDefaults(me);
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
  await initialiseNotificationDefaults(me);
  expect(enableMarmotPush).toHaveBeenCalledTimes(1);
});

it('does not enable a second account when another account stored OFF', async () => {
  await AsyncStorage.setItem('marmot_push_enabled_v1_other', '0');
  await initialiseNotificationDefaults(me);
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
  await initialiseNotificationDefaults(me);
  expect(enableMarmotPush).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem(watcherKey)).toBe(before);
});

it('preserves Instant alerts OFF', async () => {
  await AsyncStorage.setItem(pushKey, '0');
  await initialiseNotificationDefaults(me);
  expect(enableMarmotPush).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(pushKey)).toBe('0');
});

it('makes no decision for an account that is not the live one', async () => {
  setActivePubkeyForWalletStorage('other');
  await initialiseNotificationDefaults(me);
  expect(requestNotificationPermission).not.toHaveBeenCalled();
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
  await initialiseNotificationDefaults(me);
  expect(enableMarmotPush).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(pushKey)).toBe('1');
  expect(await AsyncStorage.getItem(watcherKey)).toBe(before);
});

it('lets only the live account decide when a switch lands mid-queue', async () => {
  const first = initialiseNotificationDefaults(me);
  setActivePubkeyForWalletStorage('second');
  await Promise.all([first, initialiseNotificationDefaults('second')]);
  expect(enableMarmotPush).toHaveBeenCalledTimes(1);
  expect(enableMarmotPush).toHaveBeenCalledWith('second', expect.anything());
  expect(await AsyncStorage.getItem(pushKey)).toBeNull();
  expect(await AsyncStorage.getItem(watcherKey)).toBeNull();
  expect((await loadWatcherState('second')).categories.dm).toBe(true);
});

it('reconciles new categories for an already push-enabled account without enabling again', async () => {
  await AsyncStorage.setItem(pushKey, '1');
  await initialiseNotificationDefaults(me);
  expect(enableMarmotPush).not.toHaveBeenCalled();
  expect((await loadWatcherState(me)).categories).toEqual({
    dm: true,
    zap: true,
    mention: true,
    payment: true,
  });
  expect(scheduleWatcherReconciliation).toHaveBeenCalledWith(me);
});

it.each([
  ['switch', 'second'],
  ['sign-out', null],
])('leaves defaults retryable when %s cancels token acquisition', async (_action, next) => {
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
    // The real enable path discards the token and writes nothing for a stale task.
    return { status: stillActive() ? 'enabled' : 'unavailable' };
  });
  const setup = initialiseNotificationDefaults(me);
  await tokenStarted;
  expect(await AsyncStorage.multiGet([pushKey, decisionKey, watcherKey])).toEqual([
    [pushKey, null],
    [decisionKey, null],
    [watcherKey, null],
  ]);
  setActivePubkeyForWalletStorage(next);
  release();
  await setup;
  expect(await AsyncStorage.multiGet([pushKey, decisionKey, watcherKey])).toEqual([
    [pushKey, null],
    [decisionKey, null],
    [watcherKey, null],
  ]);
  expect(scheduleWatcherReconciliation).not.toHaveBeenCalled();
  setActivePubkeyForWalletStorage(me);
  await initialiseNotificationDefaults(me);
  expect(await AsyncStorage.getItem(pushKey)).toBe('1');
  expect((await loadWatcherState(me)).categories.dm).toBe(true);
});

it.each(['no-permission', 'unavailable'])('does not commit defaults after %s', async (status) => {
  (enableMarmotPush as jest.Mock).mockResolvedValueOnce({ status });
  await initialiseNotificationDefaults(me);
  expect(await AsyncStorage.getItem(pushKey)).toBeNull();
  expect(await AsyncStorage.getItem(decisionKey)).toBeNull();
  expect(await AsyncStorage.getItem(watcherKey)).toBeNull();
  await initialiseNotificationDefaults(me);
  expect(await AsyncStorage.getItem(pushKey)).toBe('1');
});

it.each(['watcher', 'push-off'])(
  'retries incomplete defaults after a failed %s preference write',
  async (failedPreference) => {
    if (failedPreference === 'push-off') {
      await AsyncStorage.setItem('marmot_push_enabled_v1_other', '0');
    }
    const failedKey = failedPreference === 'watcher' ? watcherKey : pushKey;
    let failNext = true;
    setItem.mockImplementation(async (key: string, value: string) => {
      if (key === failedKey && failNext) {
        failNext = false;
        throw new Error('disk full');
      }
      return originalSetItem(key, value);
    });
    await expect(initialiseNotificationDefaults(me)).rejects.toThrow('disk full');
    expect(await AsyncStorage.getItem(decisionKey)).toBeNull();
    expect(await AsyncStorage.getItem(failedKey)).toBeNull();
    // Other writes already landed; a later launch must fill the missing preference.
    expect(
      await AsyncStorage.getItem(failedPreference === 'watcher' ? pushKey : watcherKey),
    ).not.toBeNull();
    await initialiseNotificationDefaults(me);
    const enabled = failedPreference === 'watcher';
    expect(await AsyncStorage.getItem(pushKey)).toBe(enabled ? '1' : '0');
    expect((await loadWatcherState(me)).categories).toEqual({
      dm: enabled,
      zap: enabled,
      mention: enabled,
      payment: enabled,
    });
    expect(await AsyncStorage.getItem(decisionKey)).not.toBeNull();
    expect(enableMarmotPush).toHaveBeenCalledTimes(enabled ? 1 : 0);
  },
);

// A crash (or a failed write) right before the marker: both preferences
// already landed, which is itself a complete decision — the next launch keeps
// them, enables nothing twice, and has nothing left to write.
it('finds nothing left to redo after a setup interrupted before the decision marker', async () => {
  let failNext = true;
  setItem.mockImplementation(async (key: string, value: string) => {
    if (key === decisionKey && failNext) {
      failNext = false;
      throw new Error('crashed before the marker');
    }
    return originalSetItem(key, value);
  });
  await expect(initialiseNotificationDefaults(me)).rejects.toThrow('crashed');
  expect(await AsyncStorage.getItem(pushKey)).toBe('1');
  expect(await AsyncStorage.getItem(watcherKey)).not.toBeNull();
  expect(await AsyncStorage.getItem(decisionKey)).toBeNull();
  setItem.mockClear();
  await initialiseNotificationDefaults(me);
  expect(setItem.mock.calls.map(([key]: [string]) => key)).not.toContain(pushKey);
  expect(await AsyncStorage.getItem(pushKey)).toBe('1');
  expect((await loadWatcherState(me)).categories.dm).toBe(true);
  expect(enableMarmotPush).toHaveBeenCalledTimes(1);
});

it.each([
  ['enabling', false],
  ['opting out', true],
])('writes the decision marker last when %s', async (_label, otherAccount) => {
  if (otherAccount) await AsyncStorage.setItem('marmot_push_enabled_v1_other', '0');
  await initialiseNotificationDefaults(me);
  const ownWrites = setItem.mock.calls
    .map(([key]: [string]) => key)
    .filter((key: string) => key.endsWith(`_${me}`));
  expect(ownWrites.length).toBeGreaterThan(1);
  expect(ownWrites[ownWrites.length - 1]).toBe(decisionKey);
  expect(ownWrites.indexOf(decisionKey)).toBe(ownWrites.length - 1);
});

// The foreground permission helper asks an undetermined OS permission even
// when no automatic push enablement is needed.
it.each(['decision', 'both-preferences', 'instant-off', 'additional-account'])(
  'requests OS permission independently of saved %s choices',
  async (scenario) => {
    if (scenario === 'decision') {
      await AsyncStorage.setItem(decisionKey, '1');
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
    await initialiseNotificationDefaults(me);
    expect(requestNotificationPermission).toHaveBeenCalledTimes(1);
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(enableMarmotPush).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(pushKey)).not.toBe('1');
  },
);

it.each([
  ['watcher', watcherKey],
  ['push-off', pushKey],
])('stops writing when the account changes during %s persistence', async (stage, pausedKey) => {
  await AsyncStorage.setItem('marmot_push_enabled_v1_other', '0');
  const { paused, release } = pauseWrite(pausedKey);
  const setup = initialiseNotificationDefaults(me);
  await paused;
  setActivePubkeyForWalletStorage(null);
  release();
  await setup;
  expect(await AsyncStorage.getItem(decisionKey)).toBeNull();
  if (stage === 'watcher') {
    expect(await AsyncStorage.getItem(pushKey)).toBeNull();
    expect(scheduleWatcherReconciliation).not.toHaveBeenCalled();
  }
});

// The user turns Instant alerts ON in Settings while the automatic run (which
// decided OFF, another account having a preference) is still persisting: the
// user's choice must stand, with no automatic OFF or marker written over it.
it('keeps a manual Instant alerts ON made during automatic persistence', async () => {
  await AsyncStorage.setItem('marmot_push_enabled_v1_other', '0');
  const { paused, release } = pauseWrite(watcherKey);
  const setup = initialiseNotificationDefaults(me);
  await paused;
  // What the real interactive enableMarmotPush does: note the manual change
  // synchronously, then persist the user's choice.
  (enableMarmotPush as jest.Mock).mockImplementationOnce(async (pubkey: string) => {
    noteManualNotificationChange();
    await AsyncStorage.setItem(`notification_preference_explicit_v1_${pubkey}`, '1');
    await AsyncStorage.setItem(`marmot_push_enabled_v1_${pubkey}`, '1');
    return { status: 'enabled', sync: null };
  });
  const manual = enableMarmotPush(me);
  release();
  await Promise.all([setup, manual]);
  expect(await AsyncStorage.getItem(pushKey)).toBe('1');
  expect(await AsyncStorage.getItem(decisionKey)).toBe('1');
  expect(scheduleWatcherReconciliation).not.toHaveBeenCalled();
  // Settled: a later launch has nothing left to decide.
  setItem.mockClear();
  await initialiseNotificationDefaults(me);
  expect(setItem.mock.calls.map(([key]: [string]) => key)).not.toContain(pushKey);
  expect(await AsyncStorage.getItem(pushKey)).toBe('1');
});

it('keeps a manual More alerts choice made during automatic persistence', async () => {
  await AsyncStorage.setItem('marmot_push_enabled_v1_other', '0');
  const { paused, release } = pauseWrite(pushKey); // the watcher OFF default already landed
  const setup = initialiseNotificationDefaults(me);
  await paused;
  // What setWatcherCategory does: note the manual change, then save the choice.
  noteManualNotificationChange();
  await saveWatcherState(me, {
    ...(await loadWatcherState(me)),
    explicitlySet: true,
    categories: { dm: true, zap: false, mention: false, payment: false },
  });
  release();
  await setup;
  expect((await loadWatcherState(me)).categories.dm).toBe(true);
  expect(await AsyncStorage.getItem(decisionKey)).toBeNull();
  // Both preferences are stored now, so the next launch leaves them alone.
  await initialiseNotificationDefaults(me);
  expect((await loadWatcherState(me)).categories.dm).toBe(true);
  expect(await AsyncStorage.getItem(pushKey)).toBe('0');
});
