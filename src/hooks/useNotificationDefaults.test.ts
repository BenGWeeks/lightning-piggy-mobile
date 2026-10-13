import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import { useNotificationDefaults } from './useNotificationDefaults';
import { enableMarmotPush } from '../services/marmotPushRegistration';

let mockAccount = { isLoggedIn: true, pubkey: 'first' as string | null };
let mockBlur: (() => void) | undefined;
jest.mock('../contexts/NostrContext', () => ({ useNostr: () => mockAccount }));
jest.mock('@react-navigation/native', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useFocusEffect: (effect: () => (() => void) | void) =>
      useEffect(() => {
        const cleanup = effect();
        mockBlur = cleanup || undefined;
        return cleanup;
      }, [effect]),
  };
});
jest.mock('../services/watcherPush', () => ({ scheduleWatcherReconciliation: jest.fn() }));
jest.mock('../services/watcherRegistration', () => ({
  NO_CATEGORIES: { dm: false, zap: false, mention: false, payment: false },
  WATCHER_CATEGORIES: ['dm', 'zap', 'mention', 'payment'],
  anyCategory: (c: Record<string, boolean>) => Object.values(c).some(Boolean),
}));
jest.mock('../services/marmotPushRegistration', () => ({
  loadMarmotPushSettings: jest.fn(async () => ({ enabled: false })),
  enableMarmotPush: jest.fn(),
}));

const pushKey = 'marmot_push_enabled_v1_first';
const decisionKey = 'notification_preference_explicit_v1_first';
const watcherKey = 'watcher_push_v1_first';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockAccount = { isLoggedIn: true, pubkey: 'first' };
  AppState.currentState = 'active';
});
afterEach(() => jest.useRealTimers());

const startPendingToken = async () => {
  let release!: () => void;
  let started!: () => void;
  const tokenStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const token = new Promise<void>((resolve) => {
    release = resolve;
  });
  (enableMarmotPush as jest.Mock).mockImplementationOnce(async (pubkey, { stillActive }) => {
    started();
    await token;
    if (!stillActive()) return { status: 'unavailable' };
    await AsyncStorage.setItem(`marmot_push_enabled_v1_${pubkey}`, '1');
    return { status: 'enabled', sync: null };
  });
  const hook = renderHook(() => useNotificationDefaults());
  await act(async () => {
    jest.advanceTimersByTime(3000);
    await tokenStarted;
  });
  return { ...hook, release };
};

it('finishes first-account defaults when navigating away during token acquisition', async () => {
  const { release } = await startPendingToken();
  const pendingPush = await AsyncStorage.getItem(pushKey);
  const pendingDecision = await AsyncStorage.getItem(decisionKey);
  act(() => mockBlur?.());
  await act(async () => release());
  expect(pendingPush).toBeNull();
  expect(pendingDecision).toBeNull();
  expect(await AsyncStorage.getItem(pushKey)).toBe('1');
  expect(await AsyncStorage.getItem(decisionKey)).toBe('0');
  expect(JSON.parse((await AsyncStorage.getItem(watcherKey))!).categories).toEqual({
    dm: true,
    zap: true,
    mention: true,
    payment: true,
  });
});

it.each(['switch', 'sign-out'])(
  'cancels pending defaults on account %s after blur',
  async (action) => {
    const { rerender, release } = await startPendingToken();
    act(() => mockBlur?.());
    mockAccount =
      action === 'switch'
        ? { isLoggedIn: true, pubkey: 'second' }
        : { isLoggedIn: false, pubkey: null };
    rerender({});
    await act(async () => release());
    expect(await AsyncStorage.getItem(pushKey)).toBeNull();
    expect(await AsyncStorage.getItem(decisionKey)).toBeNull();
    expect(await AsyncStorage.getItem(watcherKey)).toBeNull();
  },
);

it('cancels setup that has not started when Wallets loses focus', async () => {
  renderHook(() => useNotificationDefaults());
  act(() => mockBlur?.());
  await act(async () => jest.advanceTimersByTime(3000));
  expect(enableMarmotPush).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(decisionKey)).toBeNull();
});
