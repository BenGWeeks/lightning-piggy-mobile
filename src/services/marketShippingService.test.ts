import { fetchShippingOptions } from './marketShippingService';
import { querySyncAbortable } from './relayQuery';
jest.mock('./nostrService', () => ({ pool: {}, trackRelays: jest.fn(), DEFAULT_RELAYS: [] }));
jest.mock('./relayQuery', () => ({ querySyncAbortable: jest.fn() }));
const input = { merchantPubkey: 'a'.repeat(64), relays: ['wss://relay.example'] };
test('invalid shipping does not silently become no-shipping checkout', async () => {
  (querySyncAbortable as jest.Mock).mockResolvedValue([
    { kind: 30406, pubkey: input.merchantPubkey, created_at: 1, tags: [['d', 'bad']] },
  ]);
  await expect(fetchShippingOptions(input)).rejects.toThrow('invalid shipping');
});
test('genuinely absent shipping remains supported with a bounded query', async () => {
  (querySyncAbortable as jest.Mock).mockResolvedValue([]);
  await expect(fetchShippingOptions(input)).resolves.toEqual([]);
  expect(querySyncAbortable).toHaveBeenLastCalledWith(
    expect.anything(),
    input.relays,
    { kinds: [30406], authors: [input.merchantPubkey], limit: 100 },
    expect.anything(),
  );
});
