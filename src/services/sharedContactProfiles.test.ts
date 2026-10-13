import { resolveSharedContactProfiles, SHARED_PROFILE_TIMEOUT_MS } from './sharedContactProfiles';
import { fetchProfilesBatch } from './nostrProfileBatch';
import * as cache from './zapSenderProfileStorage';
import { PROFILE_RELAYS } from './nostrRelayDefaults';

jest.mock('./nostrProfileBatch', () => ({ fetchProfilesBatch: jest.fn() }));
jest.mock('./zapSenderProfileStorage', () => ({ getMany: jest.fn() }));
const fetchBatch = jest.mocked(fetchProfilesBatch);
const getMany = jest.mocked(cache.getMany);
const PK = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

beforeEach(() => {
  jest.resetAllMocks();
  getMany.mockResolvedValue(new Map());
  fetchBatch.mockResolvedValue(undefined);
});

it('resolves a cached sender-shared profile and avatar while refreshing verified payment details', async () => {
  getMany.mockResolvedValue(
    new Map([
      [
        PK,
        {
          npub: 'npub_cached',
          displayName: null,
          nip05: null,
          name: 'Little Piggy',
          picture: 'https://example.com/piggy.png',
        },
      ],
    ]),
  );
  const profiles = await resolveSharedContactProfiles([{ pubkey: PK, relays: [] }]);
  expect(profiles[PK]).toMatchObject({
    name: 'Little Piggy',
    picture: 'https://example.com/piggy.png',
  });
  expect(fetchBatch).toHaveBeenCalledWith([PK], PROFILE_RELAYS, 8000, expect.any(Function), true);
});

it('batches sender-shared cache misses with PROFILE_RELAYS and nprofile hints', async () => {
  fetchBatch.mockImplementation(async (_pubkeys, _relays, _timeout, ingest) => {
    ingest({
      pubkey: PK,
      content: JSON.stringify({
        name: 'Little Piggy',
        picture: 'https://example.com/piggy.png',
        lud16: 'verified@example.com',
      }),
      created_at: 1,
    });
  });
  const result = await resolveSharedContactProfiles([
    { pubkey: PK, relays: ['wss://hint.example', PROFILE_RELAYS[0]] },
    { pubkey: OTHER, relays: [] },
  ]);
  expect(fetchBatch).toHaveBeenCalledTimes(1);
  expect(fetchBatch).toHaveBeenCalledWith(
    [PK, OTHER],
    [...PROFILE_RELAYS, 'wss://hint.example'],
    8000,
    expect.any(Function),
    true,
  );
  expect(result[PK]).toMatchObject({
    name: 'Little Piggy',
    picture: 'https://example.com/piggy.png',
    lud16: 'verified@example.com',
  });
  expect(result[OTHER]).toBeNull();
});

it('a missing profile completes as null, the card fallback sentinel', async () => {
  expect(await resolveSharedContactProfiles([{ pubkey: PK, relays: [] }])).toEqual({ [PK]: null });
});

it('a stuck lookup times out to fallback and ignores late events', async () => {
  jest.useFakeTimers();
  try {
    let ingest!: Parameters<typeof fetchProfilesBatch>[3];
    fetchBatch.mockImplementation((_pubkeys, _relays, _timeout, onEvent) => {
      ingest = onEvent;
      return new Promise(() => {});
    });
    const pending = resolveSharedContactProfiles([{ pubkey: PK, relays: [] }]);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(SHARED_PROFILE_TIMEOUT_MS);
    const result = await pending;
    expect(result).toEqual({ [PK]: null });
    ingest({ pubkey: PK, content: '{"name":"late"}', created_at: 1 });
    expect(result[PK]).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

it('a storage failure completes as fallback', async () => {
  getMany.mockRejectedValue(new Error('storage unavailable'));
  expect(await resolveSharedContactProfiles([{ pubkey: PK, relays: [] }])).toEqual({ [PK]: null });
});

it('filters private relay hints and caps unique public hints across the batch', async () => {
  const publicHints = Array.from({ length: 10 }, (_, i) => `wss://relay${i}.example`);
  await resolveSharedContactProfiles([
    {
      pubkey: PK,
      relays: ['ws://127.0.0.1', 'wss://192.168.1.1', 'wss://localhost', ...publicHints],
    },
    { pubkey: OTHER, relays: publicHints },
  ]);
  expect(fetchBatch.mock.calls[0][1]).toEqual([...PROFILE_RELAYS, ...publicHints.slice(0, 3)]);
});

it('does not connect to blocked sender-supplied hints', async () => {
  await resolveSharedContactProfiles([
    {
      pubkey: PK,
      relays: [
        'ws://relay.example',
        'wss://127.0.0.1',
        'wss://relay.example:8443',
        'wss://safe.example',
      ],
    },
  ]);
  expect(fetchBatch.mock.calls[0][1]).toEqual([...PROFILE_RELAYS, 'wss://safe.example']);
});
