// Heuristic 4 (ranked cap) and the cached pipeline the Market's
// friends-of-friends scope builds on.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildFofSet, computeFofSet, loadFofCache } from './friendsOfFriendsService';

const pk = (label: string, n = 0) => `${label}_${n}`.padStart(64, '0').slice(-64);
const user = pk('u');
const [a, b, c] = [pk('a'), pk('b'), pk('c')];

beforeEach(() => AsyncStorage.clear());

describe('buildFofSet maxSize (heuristic 4)', () => {
  const lists = {
    [a]: [pk('x', 1), pk('shared', 1), pk('shared', 2)],
    [b]: [pk('shared', 1), pk('y', 1), pk('shared', 2)],
    [c]: [pk('shared', 1), pk('z', 1)],
  };

  it('keeps the pubkeys followed by the most friends, most-shared first', () => {
    const { set } = buildFofSet(user, [a, b, c], lists, 2);
    expect([...set]).toEqual([pk('shared', 1), pk('shared', 2)]);
  });

  it('breaks ties by discovery order', () => {
    const { set } = buildFofSet(user, [a, b, c], lists, 3);
    expect([...set]).toEqual([pk('shared', 1), pk('shared', 2), pk('x', 1)]);
  });

  it('is a no-op when the set already fits (or no cap is given)', () => {
    const uncapped = [...buildFofSet(user, [a, b, c], lists).set];
    expect([...buildFofSet(user, [a, b, c], lists, 100).set]).toEqual(uncapped);
    expect(uncapped).toHaveLength(5);
  });
});

describe('computeFofSet + cache with a ranked cap', () => {
  const fetchKind3 = jest.fn(async (batch: string[]) =>
    Object.fromEntries(batch.map((f) => [f, [pk('shared'), pk(`only-${f.slice(-3)}`)]])),
  );

  it('builds, reports progress, and caches the capped set for the same cap only', async () => {
    const progress: [number, number][] = [];
    const result = await computeFofSet(user, [a, b], {
      fetchKind3,
      maxSize: 1,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect([...result.set]).toEqual([pk('shared')]);
    expect(progress).toEqual([[1, 1]]);
    expect([...(await loadFofCache(user, [a, b], 1))!.set]).toEqual([pk('shared')]);
    // A reader with another cap (or none) must not reuse a capped set.
    expect(await loadFofCache(user, [a, b], 5)).toBeNull();
    expect(await loadFofCache(user, [a, b])).toBeNull();
    // A follow / unfollow invalidates it too.
    expect(await loadFofCache(user, [a], 1)).toBeNull();
  });

  it('rejects (and caches nothing) when the fetch is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      computeFofSet(user, [a], { fetchKind3, maxSize: 1, signal: controller.signal }),
    ).rejects.toBeDefined();
    expect(await loadFofCache(user, [a], 1)).toBeNull();
  });
});
