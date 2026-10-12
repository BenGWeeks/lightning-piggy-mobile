import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMarketPreferences } from './useMarketPreferences';
let mockAccount = 'alice';
jest.mock('../contexts/NostrContext', () => ({ useNostr: () => ({ pubkey: mockAccount }) }));
beforeEach(() => {
  mockAccount = 'alice';
  jest.clearAllMocks();
});
it('gates the first query until saved seller scope and all axes are restored', async () => {
  let resolve!: (value: string) => void;
  (AsyncStorage.getItem as jest.Mock).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const h = renderHook(() => useMarketPreferences());
  expect(h.result.current.ready).toBe(false);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  const saved = { mode: 'wotFriends', merchant: 'Shop', country: 'UK', currency: 'GBP' };
  await act(async () => {}); // Let the coordinated storage read start.
  await act(async () => resolve(JSON.stringify(saved)));
  expect(h.result.current.ready).toBe(true);
  expect(h.result.current.preferences).toEqual(saved);
  await act(async () => h.result.current.update({ currency: 'USD' }));
  expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(
    'market_filters_v1_alice',
    JSON.stringify({ ...saved, currency: 'USD' }),
  );
});
it('hides previous account preferences until the new account is restored', async () => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({ mode: 'wotFriends' }));
  const h = renderHook(() => useMarketPreferences());
  await act(async () => {});
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  mockAccount = 'bob';
  h.rerender({});
  expect(h.result.current.ready).toBe(false);
  await act(async () => {});
  expect(h.result.current.preferences.mode).toBe('preferred');
  expect(AsyncStorage.getItem).toHaveBeenLastCalledWith('market_filters_v1_bob');
});
