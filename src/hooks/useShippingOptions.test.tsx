import { renderHook, waitFor } from '@testing-library/react-native';
import { useShippingOptions } from './useShippingOptions';
import { fetchShippingOptions } from '../services/marketShippingService';
import type { ShippingOption } from '../utils/marketShipping';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    require('react').useEffect(effect, [effect]),
}));
jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({ relays: [{ url: 'wss://relay.example', read: true }] }),
}));
jest.mock('../services/marketShippingService', () => ({ fetchShippingOptions: jest.fn() }));

const merchant = 'b'.repeat(64);
const option = { coordinate: `30406:${merchant}:uk`, dTag: 'uk' } as ShippingOption;

beforeEach(() => jest.clearAllMocks());

test('a physical product with an empty (quiet / timed-out relay) result is an error', async () => {
  (fetchShippingOptions as jest.Mock).mockResolvedValue([]);
  const { result } = renderHook(() => useShippingOptions(merchant, true, 'physical'));
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.options).toEqual([]);
});

test('a physical product with merchant options is ready', async () => {
  (fetchShippingOptions as jest.Mock).mockResolvedValue([option]);
  const { result } = renderHook(() => useShippingOptions(merchant, true, 'physical'));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.options).toEqual([option]);
});

test('a failed fetch is an error', async () => {
  (fetchShippingOptions as jest.Mock).mockRejectedValue(new Error('all relays failed'));
  const { result } = renderHook(() => useShippingOptions(merchant, true, 'physical'));
  await waitFor(() => expect(result.current.status).toBe('error'));
});

test('a seller-confirmed no-shipping product is ready without fetching', async () => {
  const { result } = renderHook(() => useShippingOptions(merchant, true, 'none'));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.options).toEqual([]);
  expect(fetchShippingOptions).not.toHaveBeenCalled();
});

test('a closed sheet stays idle', () => {
  const { result } = renderHook(() => useShippingOptions(merchant, false, 'physical'));
  expect(result.current.status).toBe('idle');
  expect(fetchShippingOptions).not.toHaveBeenCalled();
});
