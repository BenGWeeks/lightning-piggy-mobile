import { renderHook, waitFor } from '@testing-library/react-native';
import { bech32 } from 'bech32';
import { useBuyerOrders } from './useBuyerOrders';
import { getOrderRows } from '../services/dmDb';
import { serializeOrder } from '../utils/orderEvents';
import type { WalletTransaction } from '../types/wallet';

const NOW = 1_800_000_000;
const SELLER = 'b'.repeat(64);
const HASH = 'ab'.repeat(32);
const words = Array.from({ length: 7 }, (_, i) => Math.floor(NOW / 32 ** (6 - i)) % 32);
const INVOICE = bech32.encode(
  'lnbc21u',
  [...words, 1, 1, 20, ...bech32.toWords(Buffer.from(HASH, 'hex')), ...Array(104).fill(0)],
  2000,
);
let mockTransactions: WalletTransaction[] = [];

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('../contexts/NostrContext', () => ({ useNostr: () => ({ pubkey: 'a'.repeat(64) }) }));
jest.mock('../contexts/WalletContext', () => ({
  useWallet: () => ({ wallets: [{ transactions: mockTransactions }] }),
}));
jest.mock('../services/buyerOrderTitles', () => ({ loadBuyerOrderTitles: async () => ({}) }));
jest.mock('../services/dmDb', () => ({
  getOrderRows: jest.fn(),
  subscribeDmStorage: () => () => {},
}));

const rows = [
  {
    eventId: 'order',
    conversation: SELLER,
    fromMe: true,
    createdAt: 10,
    wireKind: 16,
    content: serializeOrder({
      kind: 16,
      type: 'order',
      orderId: 'o-1',
      amountSats: 2100,
      items: [],
      message: '',
    }),
  },
  {
    eventId: 'invoice',
    conversation: SELLER,
    fromMe: false,
    createdAt: 20,
    wireKind: 16,
    content: serializeOrder({
      kind: 16,
      type: 'payment',
      orderId: 'o-1',
      payment: { method: 'lightning', value: INVOICE },
      items: [],
      message: '',
    }),
  },
];

beforeEach(() => {
  (getOrderRows as jest.Mock).mockResolvedValue(rows);
  jest.useFakeTimers();
  jest.spyOn(Date, 'now').mockReturnValue(NOW * 1000);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it.each<[string, Partial<WalletTransaction>, boolean]>([
  ['pending', { settled: false }, false],
  ['failed with a timestamp', { settled: false, settled_at: NOW }, false],
  ['expired', { settled: false, settled_at: 0 }, false],
  ['no settlement evidence', {}, false],
  ['incoming settlement', { type: 'incoming', settled: true }, false],
  ['explicit settlement', { settled: true }, true],
  ['legacy settlement timestamp', { settled_at: NOW }, true],
])('requires a settled outgoing payment: %s', async (_scenario, tx, paid) => {
  mockTransactions = [{ type: 'outgoing', amount: 2100, paymentHash: HASH.toUpperCase(), ...tx }];
  const { result } = renderHook(() => useBuyerOrders());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.entries[0]).toMatchObject({
    status: paid ? 'paid' : 'payNow',
    jumpToRowId: paid ? 'order' : 'invoice',
  });
  expect(result.current.payNow).toBe(paid ? 0 : 1);
});
