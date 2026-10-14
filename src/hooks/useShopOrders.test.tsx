import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useShopOrders } from './useShopOrders';
import { getShopOrderRows, subscribeDmStorage } from '../services/dmDb';
import { serializeOrder } from '../utils/orderEvents';

const SELLER = 'a'.repeat(64);
const BUYER = 'b'.repeat(64);

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('../contexts/NostrContext', () => ({ useNostr: () => ({ pubkey: 'a'.repeat(64) }) }));
let mockListener: ((owner: string) => void) | undefined;
const mockUnsubscribe = jest.fn();
jest.mock('../services/dmDb', () => ({
  getShopOrderRows: jest.fn(),
  subscribeDmStorage: jest.fn((listener: (owner: string) => void) => {
    mockListener = listener;
    return mockUnsubscribe;
  }),
}));

const orderRow = (orderId: string) => ({
  owner: SELLER,
  eventId: `e-${orderId}`,
  conversation: BUYER,
  createdAt: 100,
  sender: BUYER,
  content: serializeOrder({
    kind: 16,
    type: 'order',
    orderId,
    items: [{ ref: `30402:${SELLER}:mug`, quantity: 1 }],
    message: '',
  }),
  fromMe: false,
  wireKind: 16,
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => jest.useRealTimers());

it('reads orders from the DM store (no relay subscription) and names the lines', async () => {
  (getShopOrderRows as jest.Mock).mockResolvedValue([orderRow('o1')]);
  const titles = new Map([['mug', 'Piggy mug']]);
  const { result } = renderHook(() => useShopOrders(titles));
  expect(result.current.orders).toBeNull();
  await waitFor(() => expect(result.current.orders).toHaveLength(1));
  expect(result.current.orders![0].lines[0].title).toBe('Piggy mug');
  expect(getShopOrderRows).toHaveBeenCalledWith(SELLER);
});

it('re-reads once after a burst of store writes for this account only', async () => {
  (getShopOrderRows as jest.Mock).mockResolvedValue([]);
  const titles = new Map<string, string>();
  const { result, unmount } = renderHook(() => useShopOrders(titles));
  await waitFor(() => expect(result.current.orders).toEqual([]));
  (getShopOrderRows as jest.Mock).mockResolvedValue([orderRow('o2')]);
  act(() => {
    mockListener?.('someone-else');
    mockListener?.(SELLER);
    mockListener?.(SELLER);
    jest.advanceTimersByTime(500);
  });
  await waitFor(() => expect(result.current.orders).toHaveLength(1));
  expect(getShopOrderRows).toHaveBeenCalledTimes(2);
  expect(subscribeDmStorage).toHaveBeenCalledTimes(1);
  unmount();
  expect(mockUnsubscribe).toHaveBeenCalled();
});
