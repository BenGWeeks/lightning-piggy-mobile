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
