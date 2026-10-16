import { enabledAppRelays, forgetAppRelayPrefs } from '../services/appRelayPrefs';
import { perAccountKey } from '../services/perAccountStorage';
import { APP_RELAY_PREFS_KEY } from '../services/appRelayPrefs';
import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  buyerOrderTitleGeneration,
  loadBuyerOrderTitles,
  recordBuyerOrderTitles,
  retireBuyerOrderTitles,
} from '../services/buyerOrderTitles';
import { useActiveNostrAccount } from './useActiveNostrAccount';

jest.mock('../services/nostrActiveAccount', () => ({ setCurrentUserPubkey: jest.fn() }));
jest.mock('../services/walletStorageService', () => ({
  setActivePubkeyForWalletStorage: jest.fn(),
}));

it('revives titles only for the activated account, retaining stale-checkout invalidation', async () => {
  await AsyncStorage.clear();
  const generation = buyerOrderTitleGeneration('buyer');
  retireBuyerOrderTitles('buyer');
  retireBuyerOrderTitles('other');
  const { result } = renderHook(() => useActiveNostrAccount());
  act(() => result.current[1](null));
  await recordBuyerOrderTitles('buyer', 'signed-out', { item: 'Private purchase' });
  expect(await loadBuyerOrderTitles('buyer')).toEqual({});
  act(() => result.current[1]('buyer'));
  await recordBuyerOrderTitles('buyer', 'stale', { item: 'Private purchase' }, generation);
  await recordBuyerOrderTitles('buyer', 'new', { item: 'New purchase' });
  await recordBuyerOrderTitles('other', 'other', { item: 'Other purchase' });
  expect(await loadBuyerOrderTitles('buyer')).toEqual({ new: { item: 'New purchase' } });
  expect(await loadBuyerOrderTitles('other')).toEqual({});
});

it('recovers active-account relay hydration without another read and cancels retries on switch', async () => {
  jest.useFakeTimers();
  const owner = 'retry-owner';
  const key = perAccountKey(APP_RELAY_PREFS_KEY, owner);
  await forgetAppRelayPrefs(owner);
  const read = jest.spyOn(AsyncStorage, 'getItem');
  read.mockRejectedValueOnce(new Error('storage unavailable'));
  const { result, unmount } = renderHook(() => useActiveNostrAccount());
  try {
    await act(async () => result.current[1](owner));
    expect(enabledAppRelays('default', ['wss://disabled.example'], owner)).toEqual([]);
    await AsyncStorage.setItem(key, JSON.stringify({ default: ['wss://disabled.example'] }));
    await act(async () => jest.advanceTimersByTimeAsync(3000));
    expect(
      enabledAppRelays('default', ['wss://disabled.example', 'wss://ok.example'], owner),
    ).toEqual(['wss://ok.example']);
    expect(read.mock.calls.filter(([storageKey]) => storageKey === key)).toHaveLength(2);
    await forgetAppRelayPrefs(owner);
    read.mockRejectedValueOnce(new Error('storage unavailable'));
    await act(async () => result.current[1](null));
    await act(async () => result.current[1](owner));
    await act(async () => result.current[1](null));
    const before = read.mock.calls.length;
    await act(async () => jest.advanceTimersByTimeAsync(6000));
    expect(read).toHaveBeenCalledTimes(before);
  } finally {
    unmount();
    read.mockRestore();
    await forgetAppRelayPrefs(owner);
    jest.useRealTimers();
  }
});
