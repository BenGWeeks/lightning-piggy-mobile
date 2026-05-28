// Tests for the detect-and-ping background sync (#279). The relay pool,
// identity/relay storage, and notificationService are mocked so we assert
// the detection + dedupe logic without network or native modules.

const mockQuerySync = jest.fn();
const mockLoadIdentities = jest.fn();
const mockGetUserRelays = jest.fn();
const mockFireMessageNotification = jest.fn().mockResolvedValue('id');
const mockFireCacheNotification = jest.fn().mockResolvedValue('id');
const mockFetchCachesByAuthor = jest.fn();

jest.mock('./nostrService', () => ({
  pool: { querySync: (...a: unknown[]) => mockQuerySync(...a) },
}));
jest.mock('./identitiesStore', () => ({ loadIdentities: () => mockLoadIdentities() }));
jest.mock('./nostrRelayStorage', () => ({ getUserRelays: () => mockGetUserRelays() }));
jest.mock('./notificationService', () => ({
  fireMessageNotification: (...a: unknown[]) => mockFireMessageNotification(...a),
  fireCacheNotification: (...a: unknown[]) => mockFireCacheNotification(...a),
}));
jest.mock('./nostrPlacesPublisher', () => ({
  fetchCachesByAuthor: (...a: unknown[]) => mockFetchCachesByAuthor(...a),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { runBackgroundSync } from './backgroundSyncService';

const ME = 'a'.repeat(64);
const READ_RELAYS = [{ url: 'wss://r.example', read: true, write: true }];
const SEEN_KEY = 'bg_sync_seen_ids_v1';
const CACHE_SEEN_KEY = 'bg_sync_seen_cache_comment_ids_v1';
const MY_CACHE_COORD = `37516:${ME}:my-piggy-d`;

/** Put the service into the "primed" state (baseline established) with an
 * optional set of already-seen ids. Without this a run is the first-ever
 * run and stays silent. */
async function prime(ids: string[] = []): Promise<void> {
  await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(ids));
}

/** Prime the find-log seen-set baseline so the cache-comment pass isn't a
 * first-ever silent prime. Independent key from `prime` above. */
async function primeCacheComments(ids: string[] = []): Promise<void> {
  await AsyncStorage.setItem(CACHE_SEEN_KEY, JSON.stringify(ids));
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockLoadIdentities.mockResolvedValue({ identities: [], activePubkey: ME });
  mockGetUserRelays.mockResolvedValue(READ_RELAYS);
  mockQuerySync.mockResolvedValue([]);
  // Default: user owns no caches — find-log pass short-circuits.
  mockFetchCachesByAuthor.mockResolvedValue([]);
});

it('does nothing when logged out', async () => {
  mockLoadIdentities.mockResolvedValue({ identities: [], activePubkey: null });
  const r = await runBackgroundSync();
  expect(r).toEqual({ pinged: false, freshCount: 0, freshCacheCommentCount: 0 });
  expect(mockQuerySync).not.toHaveBeenCalled();
});

it('does nothing when there are no read relays', async () => {
  mockGetUserRelays.mockResolvedValue([{ url: 'wss://w', read: false, write: true }]);
  const r = await runBackgroundSync();
  expect(r.pinged).toBe(false);
  expect(mockQuerySync).not.toHaveBeenCalled();
});

it('first-ever run primes the baseline silently (no ping) and seeds the seen-set', async () => {
  const now = Math.floor(Date.now() / 1000);
  mockQuerySync.mockResolvedValue([{ id: 'w1', kind: 1059, pubkey: 'eph', created_at: now }]);
  const r = await runBackgroundSync();
  expect(r).toEqual({ pinged: false, freshCount: 0, freshCacheCommentCount: 0 });
  expect(mockFireMessageNotification).not.toHaveBeenCalled();
  // The wrap we saw is now recorded so it won't ping on a later run.
  const seen = JSON.parse((await AsyncStorage.getItem(SEEN_KEY)) ?? '[]');
  expect(seen).toContain('w1');
});

it('pings when a new gift-wrap arrives after the baseline is primed', async () => {
  await prime(['old']);
  const now = Math.floor(Date.now() / 1000);
  mockQuerySync.mockResolvedValue([{ id: 'w1', kind: 1059, pubkey: 'eph', created_at: now }]);
  const r = await runBackgroundSync();
  expect(r).toEqual({ pinged: true, freshCount: 1, freshCacheCommentCount: 0 });
  expect(mockFireMessageNotification).toHaveBeenCalledTimes(1);
  expect(mockFireMessageNotification.mock.calls[0][0]).toMatchObject({
    kind: 'dm',
    threadId: '__background__',
  });
});

it('detects a backdated new wrap a since/created_at gate would miss (NIP-59)', async () => {
  await prime(['old']);
  const now = Math.floor(Date.now() / 1000);
  // NIP-59 randomises created_at up to 2 days back: a genuinely-new wrap can
  // carry a day-old timestamp. ID-dedup still catches it; a created_at gate
  // would not.
  mockQuerySync.mockResolvedValue([
    { id: 'wBack', kind: 1059, pubkey: 'eph', created_at: now - 24 * 60 * 60 },
  ]);
  const r = await runBackgroundSync();
  expect(r).toEqual({ pinged: true, freshCount: 1, freshCacheCommentCount: 0 });
});

it('queries a window wide enough to span the NIP-59 backdate (>= 2 days)', async () => {
  await prime([]);
  const now = Math.floor(Date.now() / 1000);
  await runBackgroundSync();
  // The DM querySync call is the first one (the cache-comment pass is
  // gated on a non-empty author-listing, which the default mock returns
  // empty for, so it never reaches querySync).
  const sinceArg = (mockQuerySync.mock.calls[0][1] as { since: number }).since;
  expect(now - sinceArg).toBeGreaterThanOrEqual(2 * 24 * 60 * 60);
});

it('ignores my own kind-4 echoes (no ping)', async () => {
  await prime(['old']);
  const now = Math.floor(Date.now() / 1000);
  mockQuerySync.mockResolvedValue([{ id: 'e1', kind: 4, pubkey: ME, created_at: now }]);
  const r = await runBackgroundSync();
  expect(r.pinged).toBe(false);
  expect(mockFireMessageNotification).not.toHaveBeenCalled();
});

it('does not re-ping a wrap whose id is already seen', async () => {
  await prime(['w1']);
  const now = Math.floor(Date.now() / 1000);
  mockQuerySync.mockResolvedValue([{ id: 'w1', kind: 1059, pubkey: 'eph', created_at: now }]);
  const r = await runBackgroundSync();
  expect(r.pinged).toBe(false);
  expect(mockFireMessageNotification).not.toHaveBeenCalled();
});

it('does not ping when nothing new arrived', async () => {
  await prime(['old']);
  mockQuerySync.mockResolvedValue([]);
  const r = await runBackgroundSync();
  expect(r.pinged).toBe(false);
  expect(mockFireMessageNotification).not.toHaveBeenCalled();
});

// --- Find-log detect-and-ping (#740) -----------------------------------

describe('cache-comment detect-and-ping (#740)', () => {
  it('short-circuits when the user owns no caches (no query, no ping)', async () => {
    await prime(['old']);
    await primeCacheComments(['old']);
    mockFetchCachesByAuthor.mockResolvedValue([]);
    const r = await runBackgroundSync();
    expect(r.freshCacheCommentCount).toBe(0);
    expect(mockFireCacheNotification).not.toHaveBeenCalled();
    // The DM pass still fires its own querySync, but the cache pass is
    // gated before reaching one. We assert no call carries the kind-1111
    // filter, which is the only one the cache pass would emit.
    const cacheCalls = mockQuerySync.mock.calls.filter((c) => {
      const f = c[1] as { kinds?: number[] };
      return Array.isArray(f.kinds) && f.kinds.includes(1111);
    });
    expect(cacheCalls.length).toBe(0);
  });

  it("queries kind-1111 with #A filter matching the user's cache coords", async () => {
    await prime(['old']);
    await primeCacheComments(['old']);
    mockFetchCachesByAuthor.mockResolvedValue([{ coord: MY_CACHE_COORD }]);
    // First querySync call is the DM pass; second is the cache pass.
    mockQuerySync.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await runBackgroundSync();
    const cacheCall = mockQuerySync.mock.calls.find((c) => {
      const f = c[1] as { kinds?: number[] };
      return Array.isArray(f.kinds) && f.kinds.includes(1111);
    });
    expect(cacheCall).toBeDefined();
    const filter = cacheCall![1] as { kinds: number[]; '#A': string[] };
    expect(filter.kinds).toEqual([1111]);
    expect(filter['#A']).toEqual([MY_CACHE_COORD]);
  });

  it('first-ever cache-comment run primes the baseline silently and seeds the seen-set', async () => {
    await prime(['old']); // DM baseline primed
    // No cache-comment baseline yet — first-ever run for that pass.
    mockFetchCachesByAuthor.mockResolvedValue([{ coord: MY_CACHE_COORD }]);
    const now = Math.floor(Date.now() / 1000);
    mockQuerySync
      .mockResolvedValueOnce([]) // DM pass
      .mockResolvedValueOnce([{ id: 'c1', kind: 1111, pubkey: 'finder', created_at: now }]);
    const r = await runBackgroundSync();
    expect(r.freshCacheCommentCount).toBe(0);
    expect(mockFireCacheNotification).not.toHaveBeenCalled();
    const seen = JSON.parse((await AsyncStorage.getItem(CACHE_SEEN_KEY)) ?? '[]');
    expect(seen).toContain('c1');
  });

  it('pings when a new find-log arrives after the baseline is primed', async () => {
    await prime(['old']);
    await primeCacheComments(['old']);
    mockFetchCachesByAuthor.mockResolvedValue([{ coord: MY_CACHE_COORD }]);
    const now = Math.floor(Date.now() / 1000);
    mockQuerySync
      .mockResolvedValueOnce([]) // DM pass
      .mockResolvedValueOnce([{ id: 'c1', kind: 1111, pubkey: 'finder', created_at: now }]);
    const r = await runBackgroundSync();
    expect(r).toEqual({ pinged: true, freshCount: 0, freshCacheCommentCount: 1 });
    expect(mockFireCacheNotification).toHaveBeenCalledTimes(1);
    expect(mockFireCacheNotification.mock.calls[0][0]).toMatchObject({
      cacheCoord: '__background__',
    });
  });

  it('ignores my own kind-1111 echoes (hider maintenance note, not a find)', async () => {
    await prime(['old']);
    await primeCacheComments(['old']);
    mockFetchCachesByAuthor.mockResolvedValue([{ coord: MY_CACHE_COORD }]);
    const now = Math.floor(Date.now() / 1000);
    mockQuerySync
      .mockResolvedValueOnce([]) // DM pass
      .mockResolvedValueOnce([{ id: 'c1', kind: 1111, pubkey: ME, created_at: now }]);
    const r = await runBackgroundSync();
    expect(r.freshCacheCommentCount).toBe(0);
    expect(mockFireCacheNotification).not.toHaveBeenCalled();
  });

  it('does not re-ping a find-log whose id is already seen', async () => {
    await prime(['old']);
    await primeCacheComments(['c1']);
    mockFetchCachesByAuthor.mockResolvedValue([{ coord: MY_CACHE_COORD }]);
    const now = Math.floor(Date.now() / 1000);
    mockQuerySync
      .mockResolvedValueOnce([]) // DM pass
      .mockResolvedValueOnce([{ id: 'c1', kind: 1111, pubkey: 'finder', created_at: now }]);
    const r = await runBackgroundSync();
    expect(r.freshCacheCommentCount).toBe(0);
    expect(mockFireCacheNotification).not.toHaveBeenCalled();
  });

  it('uses an independent seen-set from the DM pass (no cross-contamination)', async () => {
    // Same id in both streams would still ping each pass once — disjoint
    // seen-sets means the kind-1111 pass doesn't accidentally short-circuit
    // because a kind-1059 wrap with the same id ran before it.
    await prime(['shared']);
    await primeCacheComments(['old']);
    mockFetchCachesByAuthor.mockResolvedValue([{ coord: MY_CACHE_COORD }]);
    const now = Math.floor(Date.now() / 1000);
    mockQuerySync
      .mockResolvedValueOnce([]) // DM pass — nothing fresh
      .mockResolvedValueOnce([
        // Re-using the 'shared' id intentionally.
        { id: 'shared', kind: 1111, pubkey: 'finder', created_at: now },
      ]);
    const r = await runBackgroundSync();
    expect(r.freshCacheCommentCount).toBe(1);
    expect(mockFireCacheNotification).toHaveBeenCalledTimes(1);
  });

  it('fetchCachesByAuthor failure does not break the DM pass', async () => {
    await prime(['old']);
    mockFetchCachesByAuthor.mockRejectedValue(new Error('boom'));
    const now = Math.floor(Date.now() / 1000);
    mockQuerySync.mockResolvedValueOnce([{ id: 'w1', kind: 1059, pubkey: 'eph', created_at: now }]);
    const r = await runBackgroundSync();
    expect(r.freshCount).toBe(1);
    expect(r.freshCacheCommentCount).toBe(0);
    expect(mockFireMessageNotification).toHaveBeenCalledTimes(1);
    expect(mockFireCacheNotification).not.toHaveBeenCalled();
  });
});
