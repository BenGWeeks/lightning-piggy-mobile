import type { Event as NostrEvent } from 'nostr-tools';
import {
  loadInvitationKeys,
  queryInvitationKeys,
  oldInvitationKeys,
  removeInvitationKeys,
  shapeInvitationKeys,
} from './marmotInvitationKeys';
import { createMemoryMarmotBackend, createSqliteMarmotBackend } from './marmotStore';
import { retireMarmotKeyPackages } from './marmotKeyPackageRetire';
import { pool } from './nostrPool';
import { getMarmotSession } from './marmotSession';

jest.mock('./nostrPool', () => ({
  pool: { subscribeManyEose: jest.fn() },
  trackRelays: jest.fn(),
}));
jest.mock('./marmotSession', () => ({
  getMarmotSession: jest.fn(),
  quiesceMarmotSession: jest.fn(),
}));
jest.mock('./marmotStore', () => ({
  ...jest.requireActual('./marmotStore'),
  createSqliteMarmotBackend: jest.fn(),
}));
jest.mock('./marmotKeyPackageRetire', () => ({
  ...jest.requireActual('./marmotKeyPackageRetire'),
  retireMarmotKeyPackages: jest.fn(),
}));
jest.mock('../components/BrandedToast', () => ({ __esModule: true, default: { show: jest.fn() } }));
const owner = 'ab'.repeat(32);
const event = (id: string, slot = 'slot', at = 100, content = 'key'): NostrEvent => ({
  id,
  pubkey: owner,
  kind: 30443,
  created_at: at,
  content,
  sig: '',
  tags: [
    ['d', slot],
    ['client', 'White Noise Android'],
  ],
});
const shape = (events: NostrEvent[], local: string[] = []) =>
  shapeInvitationKeys(owner, [{ relay: 'wss://one.test', events }], local);
let backend: ReturnType<typeof createMemoryMarmotBackend>;
beforeEach(() => {
  jest.clearAllMocks();
  backend = createMemoryMarmotBackend();
  jest.mocked(createSqliteMarmotBackend).mockReturnValue(backend);
  jest.mocked(retireMarmotKeyPackages).mockResolvedValue('deleted');
});

test('deduplicates relay copies, groups slots and identifies only local slots', () => {
  const a = event('a', 'local');
  const keys = shapeInvitationKeys(
    owner,
    [
      {
        relay: 'wss://one.test',
        events: [a, event('b', 'remote'), { ...a, id: 'foreign', pubkey: 'other' }],
      },
      { relay: 'wss://two.test', events: [a, event('c', 'local', 101)] },
    ],
    ['local'],
  );
  expect(keys.map((k) => k.event.id)).toEqual(['c', 'a', 'b']);
  expect(keys[1].relays).toEqual(['wss://one.test', 'wss://two.test']);
  expect(keys.map((k) => k.thisPhone)).toEqual([true, true, false]);
  expect(keys[2].client).toBe('White Noise Android');
});
test('an empty newest replacement hides all older slot versions', () => {
  expect(shape([event('a'), event('b', 'slot', 101, '')])).toEqual([]);
  expect(shape([event('b'), event('a', 'slot', 100, '')])).toEqual([]);
});
test('bulk removal preserves this phone and slots with any fresh version', () => {
  const now = 40 * 86400;
  const keys = shape(
    [
      event('a', 'old'),
      event('b', 'mixed'),
      event('c', 'mixed', now),
      event('d', 'local'),
      event('e', 'expired', now),
    ],
    ['local'],
  );
  keys.find((k) => k.event.id === 'e')!.expires = now - 1;
  expect(oldInvitationKeys(keys, now).map((k) => k.event.id)).toEqual(['e', 'a']);
});
test('queries newest NIP-65 relays with bounds and reports incomplete inventory', async () => {
  const fetch = jest.fn(async (relays, filter) => {
    if (filter.kinds[0] === 10002)
      return [
        { ...event('old'), kind: 10002, tags: [['r', 'wss://old.test']] },
        { ...event('new', '', 200), kind: 10002, tags: [['r', 'wss://new.test']] },
      ];
    if (relays[0] === 'wss://broken.test') throw new Error('offline');
    return [event('a')];
  });
  const result = await loadInvitationKeys(owner, ['wss://broken.test'], fetch);
  expect(result.partial).toBe(true);
  expect(fetch.mock.calls.some(([rs]) => rs.includes('wss://new.test'))).toBe(true);
  expect(fetch.mock.calls.some(([rs]) => rs.includes('wss://old.test'))).toBe(false);
  for (const [rs, filter] of fetch.mock.calls) {
    expect(rs.length).toBeLessThanOrEqual(12);
    expect(filter.limit).toBeLessThanOrEqual(100);
    expect(filter.authors).toEqual([owner]);
  }
});
test('falls back to configured relays when NIP-65 discovery fails', async () => {
  const result = await loadInvitationKeys(owner, ['wss://one.test'], async (_, filter) => {
    if (filter.kinds?.[0] === 10002) throw new Error('offline');
    return [event('a')];
  });
  expect(result.keys).toHaveLength(1);
  expect(result.partial).toBe(true);
});
const args = (keys: ReturnType<typeof shape>) => ({
  owner,
  selected: keys,
  inventory: keys,
  relays: [],
  sign: jest.fn(),
  isCurrent: () => true,
});
test('removing an old version never retires its newer slot', async () => {
  const keys = shape([event('a'), event('b', 'slot', 101)]);
  await removeInvitationKeys({ ...args(keys), selected: [keys[1]] });
  expect(retireMarmotKeyPackages).toHaveBeenCalledWith(
    expect.objectContaining({ footprint: { slots: [], eventIds: ['a'] } }),
  );
});
test('pauses local publication before retiring the whole slot and preserves private storage', async () => {
  const pauseInvitationKey = jest.fn(async () => {
    await backend.set('meta', 'keyPackagePublicationPaused', 'true');
  });
  jest
    .mocked(getMarmotSession)
    .mockReturnValue({ pubkey: owner, pauseInvitationKey } as unknown as NonNullable<
      ReturnType<typeof getMarmotSession>
    >);
  await backend.set('keyPackages', 'private', 'retained');
  await removeInvitationKeys(args(shape([event('a')], ['slot'])));
  expect(pauseInvitationKey).toHaveBeenCalledTimes(1);
  expect(retireMarmotKeyPackages).toHaveBeenCalledWith(
    expect.objectContaining({ footprint: { slots: ['slot'], eventIds: ['a'] } }),
  );
  expect(await backend.get('keyPackages', 'private')).toBe('retained');
});
test('rejects foreign selections and stale accounts before signing', async () => {
  const keys = shape([event('a')]);
  await expect(removeInvitationKeys({ ...args(keys), isCurrent: () => false })).rejects.toThrow(
    'Account changed',
  );
  keys[0].event.pubkey = 'other';
  await expect(removeInvitationKeys(args(keys))).rejects.toThrow('another account');
  expect(retireMarmotKeyPackages).not.toHaveBeenCalled();
});
test('reports partial retirement failures instead of success', async () => {
  jest.mocked(retireMarmotKeyPackages).mockResolvedValue('failed');
  await expect(removeInvitationKeys(args(shape([event('a')])))).rejects.toThrow('incomplete');
});

test('a relay deadline rejects before nostr-tools synthesizes EOSE', async () => {
  jest.useFakeTimers();
  const close = jest.fn();
  jest.mocked(pool.subscribeManyEose).mockReturnValue({ close });
  const result = queryInvitationKeys(['wss://slow.test'], { kinds: [30443], limit: 100 });
  const rejected = expect(result).rejects.toThrow('timed out');
  await jest.advanceTimersByTimeAsync(5000);
  await rejected;
  expect(close).toHaveBeenCalledTimes(1);
  expect(jest.mocked(pool.subscribeManyEose).mock.calls[0][2].maxWait).toBe(6000);
  jest.useRealTimers();
});

test('a genuine completed relay scan clears its deadline', async () => {
  jest.useFakeTimers();
  jest.mocked(pool.subscribeManyEose).mockImplementation((_relays, _filter, params) => {
    params.onevent?.(event('a'));
    params.onclose?.(['closed automatically on eose']);
    return { close: jest.fn() };
  });
  await expect(queryInvitationKeys(['wss://one.test'], { limit: 100 })).resolves.toEqual([
    event('a'),
  ]);
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});
