import { act, renderHook, waitFor } from '@testing-library/react-native';

// conversationItems → messageContent → boltzService drags in bitcoinjs' bip32
// (ESM Jest can't resolve it); mock the one helper, as conversationItems.test does.
jest.mock('../services/boltzService', () => ({ isBitcoinAddress: () => false }));
jest.mock('../services/dmDb', () => ({ getOutgoingOrderRows: jest.fn() }));

import { getOutgoingOrderRows } from '../services/dmDb';
import { useOutgoingOrderHistory } from './useOutgoingOrderHistory';

const OWNER = 'a'.repeat(64);
const OTHER_OWNER = 'c'.repeat(64);
const PEER = 'B'.repeat(64); // upper-case on purpose: the hook must normalise

const request = (orderId: string) => ({
  id: `req-${orderId}`,
  fromMe: false,
  createdAt: 1,
  wireKind: 16,
  text: JSON.stringify({
    kind: 16,
    type: 'payment',
    orderId,
    items: [],
    message: '',
    payment: { method: 'lightning', value: `lnbc1${'a'.repeat(60)}` },
  }),
});

const row = (orderId: string, amountSats: number) => ({
  owner: OWNER,
  eventId: `o-${orderId}`,
  conversation: PEER.toLowerCase(),
  createdAt: 1,
  sender: OWNER,
  content: JSON.stringify({ kind: 16, type: 'order', orderId, amountSats, items: [], message: '' }),
  fromMe: true,
  wireKind: 16,
});

beforeEach(() => jest.clearAllMocks());

test('resolves approved totals for requests whose order is outside the loaded slice', async () => {
  (getOutgoingOrderRows as jest.Mock).mockResolvedValue([row('old', 100), row('unasked', 5)]);
  const messages = [request('old')];
  const { result } = renderHook(() => useOutgoingOrderHistory(OWNER, PEER, messages));
  expect(result.current.size).toBe(0);
  await waitFor(() => expect(result.current.get('old')).toBe(100));
  // The LIKE pre-filter is a substring match — only asked-for ids are kept.
  expect(result.current.has('unasked')).toBe(false);
  expect(getOutgoingOrderRows).toHaveBeenCalledWith(OWNER, PEER.toLowerCase(), ['old']);
});

test('a scope change with the same id set never reuses the previous totals', async () => {
  (getOutgoingOrderRows as jest.Mock).mockResolvedValue([row('old', 100)]);
  const messages = [request('old')];
  const { result, rerender } = renderHook(
    ({ owner }: { owner: string }) => useOutgoingOrderHistory(owner, PEER, messages),
    { initialProps: { owner: OWNER } },
  );
  await waitFor(() => expect(result.current.get('old')).toBe(100));
  (getOutgoingOrderRows as jest.Mock).mockReturnValue(new Promise(() => {})); // never settles
  rerender({ owner: OTHER_OWNER });
  expect(result.current.size).toBe(0);
});

test('a store failure leaves the request unverified (fail closed)', async () => {
  (getOutgoingOrderRows as jest.Mock).mockRejectedValue(new Error('store unavailable'));
  const { result } = renderHook(() => useOutgoingOrderHistory(OWNER, PEER, [request('old')]));
  await act(async () => {});
  expect(result.current.size).toBe(0);
});
