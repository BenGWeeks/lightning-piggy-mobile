import { act, renderHook } from '@testing-library/react-native';
import type { Event } from 'nostr-tools';
import { useListingRepublish } from './useListingRepublish';
import { Alert } from '../components/BrandedAlert';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({ pubkey: 'seller', relays: [] }),
}));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('../components/BrandedAlert', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('../components/BrandedToast', () => ({ Toast: { show: jest.fn() } }));
jest.mock('../services/listingRepublish', () => ({
  listingTargetRelays: () => ['wss://example.com'],
  fetchListingCoverage: jest.fn(async () => ({
    copies: [],
    relays: new Map([['wss://example.com', []]]),
  })),
  newestSignedListing: () => null,
  republishListing: jest.fn(),
}));

it('waits for confirmation then passes the complete stored event to re-signing', async () => {
  const stored: Event = {
    id: 'stored',
    sig: '',
    pubkey: 'seller',
    kind: 30402,
    created_at: 100,
    content: ' Original content ',
    tags: [
      ['d', 'subscription'],
      ['visibility', 'hidden'],
      ['type', 'subscription', 'digital'],
      ['price', '5', 'SATS', 'month'],
      ['extension', 'keep'],
    ],
  };
  const resign = jest.fn(async () => stored);
  const { result } = renderHook(() => useListingRepublish([stored], resign));
  await act(async () => {});
  expect(result.current.coverage.get('subscription')?.missing).toBe(true);
  act(() => result.current.republish(stored));
  expect(resign).not.toHaveBeenCalled();
  const buttons = jest.mocked(Alert.alert).mock.calls[0][2]!;
  expect(buttons[0].style).toBe('cancel');
  await act(async () => {
    buttons[1].onPress!();
  });
  expect(resign).toHaveBeenCalledTimes(1);
  expect(resign).toHaveBeenCalledWith(stored);
});
