import { fetchShippingOptions, fetchShippingOptionsForDisplay } from './marketShippingService';
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
test('drops options a relay returns from a pubkey other than the merchant', async () => {
  (querySyncAbortable as jest.Mock).mockResolvedValue([
    { kind: 30406, pubkey: 'b'.repeat(64), created_at: 1, tags: [['d', 'evil'], ['price', '999', 'GBP']] }, // prettier-ignore
    { kind: 30406, pubkey: input.merchantPubkey, created_at: 1, tags: [['d', 'std'], ['price', '4.5', 'GBP']] }, // prettier-ignore
  ]);
  const options = await fetchShippingOptions(input);
  expect(options.map((o) => o.dTag)).toEqual(['std']);
});
test('an all-relay connection failure is an error, never "no shipping needed"', async () => {
  (querySyncAbortable as jest.Mock).mockRejectedValue(new Error('All relays failed to connect'));
  await expect(fetchShippingOptions(input)).rejects.toThrow('All relays failed');
  expect(querySyncAbortable).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.anything(),
    expect.anything(),
    expect.objectContaining({ rejectOnAllRelaysFailure: true, rejectOnTimeout: true }),
  );
});
test('ignores unrelated same-author events of another kind instead of failing checkout', async () => {
  (querySyncAbortable as jest.Mock).mockResolvedValue([
    { kind: 1, pubkey: input.merchantPubkey, created_at: 1, tags: [], content: 'gm' },
    { kind: 30406, pubkey: input.merchantPubkey, created_at: 1, tags: [['d', 'std'], ['price', '4.5', 'GBP']] }, // prettier-ignore
  ]);
  const options = await fetchShippingOptions(input);
  expect(options.map((o) => o.dTag)).toEqual(['std']);
});
test('a response holding only another pubkey\'s 30406s fails closed instead of reading as "no shipping"', async () => {
  (querySyncAbortable as jest.Mock).mockResolvedValue([
    { kind: 30406, pubkey: 'b'.repeat(64), created_at: 1, tags: [['d', 'evil'], ['price', '999', 'GBP']] }, // prettier-ignore
  ]);
  await expect(fetchShippingOptions(input)).rejects.toThrow('another pubkey');
});

test('validates only the newest addressable revision', async () => {
  const old = {
    id: 'old',
    kind: 30406,
    pubkey: input.merchantPubkey,
    created_at: 1,
    tags: [['d', 'std']],
  };
  const current = {
    ...old,
    id: 'new',
    created_at: 2,
    tags: [
      ['d', 'std'],
      ['price', '4.5', 'GBP'],
    ],
  };
  (querySyncAbortable as jest.Mock).mockResolvedValue([current, old]);
  await expect(fetchShippingOptions(input)).resolves.toEqual([
    expect.objectContaining({ baseAmount: 4.5 }),
  ]);
  (querySyncAbortable as jest.Mock).mockResolvedValue([current, { ...old, created_at: 3 }]);
  await expect(fetchShippingOptions(input)).rejects.toThrow('invalid shipping');
});

describe('fetchShippingOptionsForDisplay (product page, #1273)', () => {
  test('shows the valid options and skips a malformed one instead of failing', async () => {
    (querySyncAbortable as jest.Mock).mockResolvedValue([
      { kind: 30406, pubkey: input.merchantPubkey, created_at: 1, tags: [['d', 'bad']] },
      { kind: 30406, pubkey: input.merchantPubkey, created_at: 1, tags: [['d', 'std'], ['price', '4.5', 'GBP']] }, // prettier-ignore
      { kind: 30406, pubkey: 'b'.repeat(64), created_at: 1, tags: [['d', 'evil'], ['price', '9', 'GBP']] }, // prettier-ignore
    ]);
    const options = await fetchShippingOptionsForDisplay(input);
    expect(options.map((o) => o.dTag)).toEqual(['std']);
  });
  test('tolerates a slow relay (no reject on timeout) but not a total relay failure', async () => {
    (querySyncAbortable as jest.Mock).mockResolvedValue([]);
    await fetchShippingOptionsForDisplay(input);
    const params = (querySyncAbortable as jest.Mock).mock.calls.at(-1)[3];
    expect(params).toEqual(expect.objectContaining({ rejectOnAllRelaysFailure: true }));
    expect(params.rejectOnTimeout).toBeUndefined();
  });
  test('keeps the newest revision of each option', async () => {
    (querySyncAbortable as jest.Mock).mockResolvedValue([
      { kind: 30406, pubkey: input.merchantPubkey, created_at: 1, tags: [['d', 'std'], ['price', '4.5', 'GBP']] }, // prettier-ignore
      { kind: 30406, pubkey: input.merchantPubkey, created_at: 2, tags: [['d', 'std'], ['price', '5', 'GBP']] }, // prettier-ignore
    ]);
    const options = await fetchShippingOptionsForDisplay(input);
    expect(options.map((o) => o.baseAmount)).toEqual([5]);
  });
});
