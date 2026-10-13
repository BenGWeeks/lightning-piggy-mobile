import AsyncStorage from '@react-native-async-storage/async-storage';
import { initialiseNotificationDefaults } from './notificationDefaults';
import { enableMarmotPush } from './marmotPushRegistration';
import { loadWatcherState, saveWatcherState } from './watcherPushStore';
import { scheduleWatcherReconciliation } from './watcherPush';

jest.mock('./watcherPush', () => ({ scheduleWatcherReconciliation: jest.fn() }));

jest.mock('./marmotPushRegistration', () => ({
  loadMarmotPushSettings: jest.fn(async () => ({ enabled: false })),
  enableMarmotPush: jest.fn(async () => ({ status: 'no-permission' })),
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
});

it('attempts the first account once, without interactive signer work, even after denial', async () => {
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

it('makes no decision after the account leaves Wallets', async () => {
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
