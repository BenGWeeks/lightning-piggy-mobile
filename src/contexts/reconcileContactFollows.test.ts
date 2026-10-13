import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchLatestContactList } from '../services/contactListSync';
import { adoptFollowSnapshot } from '../services/contactFollowFreshness';
import {
  clearFollowGateStores,
  getFollowGateStore,
  replayFollowGateStore,
  subscribeFollowSet,
} from '../services/followSetEvents';
import { startFollowGateFallback, FOLLOW_GATE_TIMEOUT_MS } from './liveDmFollowGateDecision';
import { reconcileCachedContactFollows, reconcileContactFollows } from './reconcileContactFollows';

jest.mock('../services/contactListSync', () => ({ fetchLatestContactList: jest.fn() }));
jest.mock('../services/nostrRelayStorage', () => ({ getUserRelays: jest.fn(async () => []) }));
const OWNER = 'f'.repeat(64);
const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const contacts = (pubkeys: string[]) =>
  pubkeys.map((pubkey) => ({ pubkey, relay: null, petname: null, profile: null }));
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(fetchLatestContactList).mockReset();
  clearFollowGateStores();
  await AsyncStorage.clear();
});

it('publishes readiness only after relay reconciliation, never after painting cache', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof fetchLatestContactList>>) => void;
  jest.mocked(fetchLatestContactList).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const paint = jest.fn();
  const finish = jest.fn();
  const pending = reconcileContactFollows(OWNER, [], contacts([ALICE]), paint, finish);
  await flush();
  expect(paint).toHaveBeenCalledWith(contacts([ALICE]));
  expect(finish).not.toHaveBeenCalled();
  expect(getFollowGateStore(OWNER).followHydratedRef.current).toBe(false);
  resolve({ status: 'found', base: { tags: [['p', BOB]], content: '', createdAt: 200 } });
  await pending;
  expect(finish).toHaveBeenCalledWith(contacts([BOB]));
  expect(getFollowGateStore(OWNER).followHydratedRef.current).toBe(true);
});

it.each(['follow', 'unfollow'])(
  'failed refresh preserves a concurrent %s in gate and UI',
  async (change) => {
    const initial = contacts(change === 'follow' ? [ALICE] : [ALICE, BOB]);
    const updated = contacts(change === 'follow' ? [ALICE, BOB] : [ALICE]);
    await adoptFollowSnapshot(OWNER, { contacts: initial, createdAt: 100 });
    let fail!: () => void;
    jest.mocked(fetchLatestContactList).mockReturnValueOnce(
      new Promise((resolve) => {
        fail = () => resolve({ status: 'failed' });
      }),
    );
    const paint = jest.fn();
    const finish = jest.fn();
    const pending = reconcileContactFollows(OWNER, [], initial, paint, finish);
    await flush();
    expect(paint).toHaveBeenLastCalledWith(initial);
    // Keep the write pending when the failed refresh resolves: its fallback must
    // join the same queue, rather than racing the latest snapshot's disk write.
    const localWrite = adoptFollowSnapshot(OWNER, { contacts: updated, createdAt: 200 });
    fail();
    await localWrite;
    expect(await pending).toEqual(updated);
    expect(paint).toHaveBeenLastCalledWith(updated);
    expect(finish).not.toHaveBeenCalled();
    expect([...getFollowGateStore(OWNER).followPubkeysRef.current]).toEqual(
      updated.map((c) => c.pubkey),
    );
  },
);

it('failed fetch retains deferrals through offline timeout and later authoritative recovery', async () => {
  jest.useFakeTimers();
  const store = getFollowGateStore(OWNER);
  store.followPubkeysRef.current = new Set([ALICE]);
  for (const partner of [ALICE, BOB])
    store.followGateBufferRef.current.defer({
      partnerPubkey: partner,
      entry: {
        id: partner,
        partnerPubkey: partner,
        fromMe: false,
        createdAt: 100,
        text: 'hello',
        wireKind: 4,
      },
    });
  const replay = jest.fn();
  store.deferredReplayRef.current = replay;
  const unsubscribe = subscribeFollowSet(OWNER, () => replayFollowGateStore(store));
  const fallback = startFollowGateFallback(
    store.followPubkeysRef,
    store.followHydratedRef,
    store.followGateBufferRef.current,
    replay,
  );
  try {
    jest.mocked(fetchLatestContactList).mockResolvedValueOnce({ status: 'failed' });
    const finish = jest.fn();
    await reconcileContactFollows(OWNER, [], contacts([ALICE]), jest.fn(), finish);
    expect(finish).not.toHaveBeenCalled();
    expect(store.followHydratedRef.current).toBe(false);
    expect(store.followGateBufferRef.current.size).toBe(2);
    await jest.advanceTimersByTimeAsync(FOLLOW_GATE_TIMEOUT_MS - 1);
    expect(replay).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(replay).toHaveBeenCalledTimes(1);
    expect(store.followGateBufferRef.current.size).toBe(1);
    jest.mocked(fetchLatestContactList).mockResolvedValueOnce({
      status: 'found',
      base: {
        tags: [
          ['p', ALICE],
          ['p', BOB],
        ],
        content: '',
        createdAt: 200,
      },
    });
    await reconcileContactFollows(OWNER, [], contacts([ALICE]), jest.fn(), finish);
    expect(store.followHydratedRef.current).toBe(true);
    expect(store.followGateBufferRef.current.size).toBe(0);
    expect(replay).toHaveBeenCalledTimes(2);
    expect(finish).toHaveBeenCalledWith(contacts([ALICE, BOB]));
  } finally {
    fallback.dispose();
    unsubscribe();
    jest.useRealTimers();
  }
});

it('confirmed empty relay results complete hydration', async () => {
  jest.mocked(fetchLatestContactList).mockResolvedValueOnce({ status: 'empty', confirmedBy: 2 });
  const finish = jest.fn();
  await reconcileContactFollows(OWNER, [], null, jest.fn(), finish);
  expect(finish).toHaveBeenCalledWith([]);
  expect(getFollowGateStore(OWNER).followHydratedRef.current).toBe(true);
});

it.each(['switch', 'sign-out'])(
  'rejects an old refresh after %s and returning A→B→A',
  async (transition) => {
    let resolve!: (value: Awaited<ReturnType<typeof fetchLatestContactList>>) => void;
    jest.mocked(fetchLatestContactList).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const finish = jest.fn();
    const pending = reconcileContactFollows(OWNER, [], null, jest.fn(), finish);
    await flush();
    clearFollowGateStores();
    if (transition === 'switch') getFollowGateStore(BOB);
    // The delayed A refresh completes while A is signed out / B is active.
    resolve({ status: 'found', base: { tags: [['p', ALICE]], content: '', createdAt: 200 } });
    await pending;
    expect(finish).not.toHaveBeenCalled();
    // Return to A: the old callback must not have recreated a hydrated store.
    const returned = getFollowGateStore(OWNER);
    expect(returned.adopted).toBe(false);
    expect(returned.followHydratedRef.current).toBe(false);
    expect(returned.followPubkeysRef.current.size).toBe(0);
    jest.mocked(fetchLatestContactList).mockResolvedValueOnce({
      status: 'found',
      base: { tags: [['p', BOB]], content: '', createdAt: 300 },
    });
    await reconcileContactFollows(OWNER, [], null, jest.fn(), finish);
    expect(returned.followHydratedRef.current).toBe(true);
    expect([...returned.followPubkeysRef.current]).toEqual([BOB]);
  },
);

it.each(['switch', 'sign-out'])(
  'does not recreate old follows when %s happens during both cache reads',
  async (transition) => {
    const original = jest.mocked(AsyncStorage.multiGet).getMockImplementation()!;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reads = jest.spyOn(AsyncStorage, 'multiGet').mockImplementation(async (keys) => {
      await blocked;
      return original(keys);
    });
    jest.mocked(fetchLatestContactList).mockResolvedValueOnce({
      status: 'found',
      base: { tags: [['p', ALICE]], content: '', createdAt: 200 },
    });
    const paint = jest.fn();
    const finish = jest.fn();
    try {
      const pending = reconcileCachedContactFollows(OWNER, [], paint, finish);
      expect(reads).toHaveBeenCalledTimes(2);
      clearFollowGateStores();
      if (transition === 'switch') getFollowGateStore(BOB);
      release();
      await pending;
      const returned = getFollowGateStore(OWNER);
      expect(returned.adopted).toBe(false);
      expect(returned.followHydratedRef.current).toBe(false);
      expect(returned.followPubkeysRef.current.size).toBe(0);
      expect(paint).not.toHaveBeenCalled();
      expect(finish).not.toHaveBeenCalled();
    } finally {
      reads.mockRestore();
    }
  },
);
