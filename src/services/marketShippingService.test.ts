import { finalizeEvent, getPublicKey } from 'nostr-tools';
import {
  fetchShippingOptions,
  fetchShippingOptionsForDisplay,
  shippingOptionFilters,
} from './marketShippingService';
import { querySyncAbortable } from './relayQuery';
import { acquireMarketListingsPool } from './marketListingsPool';
import * as pacing from '../contexts/nostrDecryptPacing';
import * as verification from './nostrVerifyCache';
// Exercise real hash/signature validation without the facade's dev perf timer.
jest.mock('./nostrCrypto', () => {
  const { getEventHash, verifyEvent } = jest.requireActual('nostr-tools/pure');
  return { nostrGetEventHash: getEventHash, nostrVerifyEvent: verifyEvent };
});
afterEach(() => verification.__resetVerifiedEventCache());
jest.mock('./marketListingsPool', () => ({
  acquireMarketListingsPool: jest.fn(),
}));
beforeEach(() => {
  (acquireMarketListingsPool as jest.Mock).mockReturnValue({
    pool: { structureOnly: true },
    release: jest.fn(),
  });
});
jest.mock('./nostrService', () => ({ pool: {}, trackRelays: jest.fn(), DEFAULT_RELAYS: [] }));
jest.mock('./relayQuery', () => ({ querySyncAbortable: jest.fn() }));
const input = {
  merchantPubkey: 'a'.repeat(64),
  relays: ['wss://relay.example'],
  coordinates: [`30406:${'a'.repeat(64)}:std`],
};
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

test('fetches exact references grouped by embedded author and validates unsolicited results', async () => {
  const other = 'b'.repeat(64);
  const coordinates = [...input.coordinates, `30406:${other}:std`, `30406:${other}:zone:colon`];
  const option = (pubkey: string, d: string) => ({
    kind: 30406,
    pubkey,
    created_at: 1,
    tags: [
      ['d', d],
      ['price', '5', 'GBP'],
    ],
  });
  (querySyncAbortable as jest.Mock)
    .mockReset()
    .mockImplementation((_pool, _relays, filter) =>
      Promise.resolve(
        filter.kinds[0] === 5
          ? []
          : [
              option(input.merchantPubkey, 'std'),
              option(other, 'std'),
              option(other, 'zone:colon'),
              option(other, 'unsolicited'),
              option('c'.repeat(64), 'std'),
            ],
      ),
    );
  const options = await fetchShippingOptionsForDisplay({ ...input, coordinates });
  expect(options.map((o) => o.coordinate).sort()).toEqual([...coordinates].sort());
  const filters = (querySyncAbortable as jest.Mock).mock.calls
    .map((c) => c[2])
    .filter((f) => f.kinds[0] === 30406);
  // Different identifier sets cannot share a filter without cross-matches.
  expect(filters).toEqual([
    {
      kinds: [30406],
      authors: [input.merchantPubkey],
      '#d': ['std'],
      limit: 100,
    },
    {
      kinds: [30406],
      authors: [other],
      '#d': ['std', 'zone:colon'],
      limit: 100,
    },
  ]);
});

describe('shippingOptionFilters (batched across sellers)', () => {
  const author = (i: number) => i.toString(16).padStart(64, '0');
  test('caps each query at 20 authors and 100 coordinates, with a bounded limit', () => {
    const many = Array.from({ length: 45 }, (_, i) => `30406:${author(i)}:std`);
    const filters = shippingOptionFilters(many);
    expect(filters.map((f) => f.authors!.length)).toEqual([20, 20, 5]);
    expect(filters.every((f) => f['#d']!.length === 1 && f.limit === 100)).toBe(true);
    const oneSeller = Array.from({ length: 150 }, (_, i) => `30406:${author(1)}:zone-${i}`);
    const chunks = shippingOptionFilters(oneSeller);
    expect(chunks.map((f) => f['#d']!.length)).toEqual([100, 50]);
    expect(chunks.map((f) => f.limit)).toEqual([200, 100]);
  });
  test('dedupes and skips malformed coordinates', () => {
    const ok = `30406:${author(2)}:std`;
    expect(shippingOptionFilters([ok, ok, '30402:abc:std', `30406:${author(2)}:`])).toEqual([
      { kinds: [30406], authors: [author(2)], '#d': ['std'], limit: 100 },
    ]);
    expect(shippingOptionFilters([])).toEqual([]);
  });
});

test.each(['a', 'e'])('applies verified author-owned %s deletions before quoting', async (tag) => {
  const key = new Uint8Array(32).fill(12);
  const author = getPublicKey(key);
  const coordinate = `30406:${author}:std`;
  const option = finalizeEvent(
    {
      kind: 30406,
      created_at: 100,
      content: '',
      tags: [
        ['d', 'std'],
        ['price', '5', 'GBP'],
      ],
    },
    key,
  );
  const target = [tag, tag === 'a' ? coordinate : option.id];
  const deletion = finalizeEvent({ kind: 5, created_at: 200, content: '', tags: [target] }, key);
  const foreign = finalizeEvent(
    { kind: 5, created_at: 200, content: '', tags: [target] },
    new Uint8Array(32).fill(13),
  );
  const forged = { ...deletion, content: 'tampered' };
  let deletions = [foreign, forged];
  (querySyncAbortable as jest.Mock)
    .mockReset()
    .mockImplementation((_pool, _relays, filter) =>
      Promise.resolve(filter.kinds[0] === 5 ? deletions : [option]),
    );
  const request = { ...input, merchantPubkey: author, coordinates: [coordinate] };
  await expect(fetchShippingOptionsForDisplay(request)).resolves.toHaveLength(1);
  deletions = [foreign, forged, deletion];
  await expect(fetchShippingOptionsForDisplay(request)).resolves.toEqual([]);
  if (tag === 'a') {
    const replacement = finalizeEvent({ ...option, created_at: 201 }, key);
    (querySyncAbortable as jest.Mock).mockImplementation((_pool, _relays, filter) =>
      Promise.resolve(filter.kinds[0] === 5 ? deletions : [replacement]),
    );
    await expect(fetchShippingOptionsForDisplay(request)).resolves.toHaveLength(1);
  }
});

test('delivers a 100-zone deletion burst without eager crypto and paces each verification', async () => {
  const structureOnly = { structureOnly: true };
  const release = jest.fn();
  (acquireMarketListingsPool as jest.Mock).mockReturnValue({ pool: structureOnly, release });
  const trace: string[] = [];
  const maybeYield = jest.fn(async () => {
    trace.push('yield');
  });
  const dispose = jest.fn();
  const scheduler = jest.spyOn(pacing, 'createYieldScheduler').mockReturnValue({
    maybeYield,
    dispose,
    yieldCount: 0,
  });
  const verify = jest.spyOn(verification, 'verifyEventCached').mockImplementation(() => {
    trace.push('verify');
    return true;
  });
  const options = Array.from({ length: 100 }, (_, i) => ({
    id: `option-${i}`,
    pubkey: input.merchantPubkey,
    kind: 30406,
    created_at: 100,
    content: '',
    sig: '',
    tags: [
      ['d', `zone-${i}`],
      ['price', '5', 'GBP'],
    ],
  }));
  const deletions = options.map((option, i) => ({
    ...option,
    id: `deletion-${i}`,
    kind: 5,
    created_at: 200,
    tags: [['e', option.id]],
  }));
  (querySyncAbortable as jest.Mock)
    .mockReset()
    .mockImplementation(async (queryPool, _relays, filter) => {
      if (filter.kinds[0] !== 5) return options;
      // Model the shared pool's synchronous verification during event delivery.
      if (queryPool !== structureOnly) deletions.forEach(() => trace.push('eager verify'));
      return filter['#e'] ? deletions : [];
    });
  try {
    await expect(
      fetchShippingOptionsForDisplay({
        ...input,
        coordinates: options.map((option) => `30406:${option.pubkey}:${option.tags[0][1]}`),
      }),
    ).resolves.toEqual([]);
    expect(trace).toEqual(Array.from({ length: 100 }, () => ['yield', 'verify']).flat());
    expect(acquireMarketListingsPool).toHaveBeenCalledWith(input.relays);
    expect(release).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    const filters = (querySyncAbortable as jest.Mock).mock.calls.map((call) => call[2]);
    expect(filters.filter((filter) => filter.kinds[0] === 5)).toEqual([
      expect.objectContaining({ '#a': expect.any(Array), limit: 200 }),
      expect.objectContaining({ '#e': expect.any(Array), limit: 200 }),
    ]);
  } finally {
    scheduler.mockRestore();
    verify.mockRestore();
  }
});

test('releases the structure-only pool when a deletion query fails', async () => {
  const release = jest.fn();
  (acquireMarketListingsPool as jest.Mock).mockReturnValue({ pool: {}, release });
  (querySyncAbortable as jest.Mock)
    .mockReset()
    .mockImplementation(async (_pool, _relays, filter) => {
      if (filter.kinds[0] === 5) throw new Error('deletion query failed');
      return [
        {
          id: 'option',
          kind: 30406,
          pubkey: input.merchantPubkey,
          created_at: 100,
          tags: [
            ['d', 'std'],
            ['price', '5', 'GBP'],
          ],
        },
      ];
    });
  await expect(fetchShippingOptionsForDisplay(input)).rejects.toThrow('deletion query failed');
  expect(release).toHaveBeenCalledTimes(1);
});

test('retains all 20 requested pairs when 380 newer cross-matches would truncate a relay response', async () => {
  const authors = Array.from({ length: 20 }, (_, i) => i.toString(16).padStart(64, '0'));
  const coordinates = authors.map((author, i) => `30406:${author}:zone-${i}`);
  const events = authors
    .flatMap((pubkey, i) =>
      authors.map((_, j) => ({
        id: `${i}-${j}`,
        pubkey,
        kind: 30406,
        created_at: i === j ? 1 : 2,
        tags: [
          ['d', `zone-${j}`],
          ['price', '5', 'GBP'],
          ['country', 'GB'],
        ],
      })),
    )
    .sort((a, b) => b.created_at - a.created_at);
  (querySyncAbortable as jest.Mock)
    .mockReset()
    .mockImplementation(async (_pool, _relays, filter) => {
      if (filter.kinds[0] === 5) return [];
      // Model relay filtering and newest-first limit BEFORE client post-filtering.
      return events
        .filter(
          (event) =>
            filter.authors.includes(event.pubkey) && filter['#d'].includes(event.tags[0][1]),
        )
        .slice(0, filter.limit);
    });
  const options = await fetchShippingOptionsForDisplay({ ...input, coordinates });
  expect(options.map((option) => option.coordinate).sort()).toEqual([...coordinates].sort());
});
