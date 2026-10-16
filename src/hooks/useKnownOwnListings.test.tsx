import { act, renderHook } from '@testing-library/react-native';
import type { Event } from 'nostr-tools';
import { PREFERRED_SELLERS_ACCOUNT } from '../services/marketPreferredSellers';
import { TEST_ACCOUNT_KEYS } from '../utils/testAccounts';
import { useKnownOwnListings } from './useKnownOwnListings';

const mockSnapshots = jest.fn();
const mockRead = jest.fn();
let mockNotify: () => void;
jest.mock('../services/marketStorage', () => ({
  loadedMarketSnapshots: (...args: unknown[]) => mockSnapshots(...args),
  readLoadedMarketSnapshots: (...args: unknown[]) => mockRead(...args),
  subscribeMarketSnapshots: (listener: () => void) => {
    mockNotify = listener;
    return jest.fn();
  },
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, [effect]);
  },
}));

it('updates shared shortcut state when an own listing arrives in the Market snapshot', () => {
  const pubkey = 'a'.repeat(64);
  const empty: Event[] = [];
  mockSnapshots.mockReturnValue([]);
  const first = renderHook(() => useKnownOwnListings(pubkey, empty));
  expect(first.result.current).toBe(false);
  mockSnapshots.mockReturnValue([{ products: [{ listing: { event: { kind: 30402, pubkey } } }] }]);
  act(() => mockNotify());
  expect(first.result.current).toBe(true);
  expect(mockSnapshots).toHaveBeenLastCalledWith([pubkey, PREFERRED_SELLERS_ACCOUNT]);
  mockSnapshots.mockReturnValue([]);
  act(() => mockNotify());
  expect(first.result.current).toBe(false);
});

it('uses own seller listings and drops them when the account changes', () => {
  mockSnapshots.mockReturnValue([]);
  const pubkey = 'a'.repeat(64);
  const listings = [{ kind: 30402, pubkey }] as Event[];
  const { result, rerender } = renderHook<boolean, { account: string }>(
    ({ account }) => useKnownOwnListings(account, listings),
    {
      initialProps: { account: pubkey },
    },
  );
  expect(result.current).toBe(true);
  rerender({ account: 'b'.repeat(64) });
  expect(result.current).toBe(false);
});

it('recognises Big Piggy’s authored dev fixture without a kind-30402 event', () => {
  mockSnapshots.mockReturnValue([]);
  const { result } = renderHook(() => useKnownOwnListings(TEST_ACCOUNT_KEYS.big, []));
  expect(result.current).toBe(true);
});
