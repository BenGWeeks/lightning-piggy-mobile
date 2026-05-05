/**
 * Round-trip + TTL + LRU coverage for the zap-sender profile cache (#95).
 * Mirrors the patterns established in zapCounterpartyStorage so reviewers
 * familiar with that file can scan the diff quickly.
 */
// Use the official in-memory mock — jest-expo doesn't auto-mock
// AsyncStorage, and the real native module obviously can't load in Node.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  __TEST__,
  __resetForTests,
  get,
  getMany,
  setMany,
  type CachedZapSenderProfile,
} from './zapSenderProfileStorage';

const STORAGE_KEY = 'zap_sender_profiles_v1';

function profile(overrides: Partial<CachedZapSenderProfile> = {}): CachedZapSenderProfile {
  return {
    npub: 'npub1example',
    name: 'satoshi',
    displayName: 'Satoshi Nakamoto',
    picture: 'https://example.com/avatar.png',
    nip05: 'satoshi@example.com',
    ...overrides,
  };
}

describe('zapSenderProfileStorage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetForTests();
  });

  it('persists and reloads a profile across in-memory cache resets', async () => {
    const pk = 'a'.repeat(64);
    await setMany(new Map([[pk, profile({ name: 'alice' })]]));

    // Drop the in-memory mirror to force a re-read from AsyncStorage.
    __resetForTests();

    const hit = await get(pk);
    expect(hit).not.toBeNull();
    expect(hit?.name).toBe('alice');
  });

  it('returns null for an unknown pubkey', async () => {
    expect(await get('z'.repeat(64))).toBeNull();
  });

  it('getMany returns only the pubkeys present in cache', async () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    const c = 'c'.repeat(64);
    await setMany(
      new Map([
        [a, profile({ name: 'alice' })],
        [b, profile({ name: 'bob' })],
      ]),
    );
    const out = await getMany([a, b, c]);
    expect(out.size).toBe(2);
    expect(out.get(a)?.name).toBe('alice');
    expect(out.get(b)?.name).toBe('bob');
    expect(out.has(c)).toBe(false);
  });

  it('treats entries older than TTL_MS as misses (get + getMany)', async () => {
    const pk = 'a'.repeat(64);
    await setMany(new Map([[pk, profile({ name: 'alice' })]]));

    // Roll the clock forward past TTL.
    const realNow = Date.now;
    try {
      jest.spyOn(Date, 'now').mockImplementation(() => realNow() + __TEST__.TTL_MS + 1);

      expect(await get(pk)).toBeNull();
      expect((await getMany([pk])).has(pk)).toBe(false);
    } finally {
      (Date.now as jest.Mock).mockRestore?.();
    }
  });

  it('still returns entries inside the TTL window', async () => {
    const pk = 'a'.repeat(64);
    await setMany(new Map([[pk, profile({ name: 'alice' })]]));

    const realNow = Date.now;
    try {
      jest.spyOn(Date, 'now').mockImplementation(() => realNow() + __TEST__.TTL_MS - 1000);
      expect(await get(pk)).not.toBeNull();
    } finally {
      (Date.now as jest.Mock).mockRestore?.();
    }
  });

  it('evicts the oldest entries once the LRU cap is exceeded', async () => {
    // Seed MAX_ENTRIES with stable, increasing savedAt values so the
    // eviction order is deterministic.
    const realNow = Date.now;
    let cursor = realNow();
    const tickMock = jest.spyOn(Date, 'now').mockImplementation(() => cursor);

    try {
      // Fill cache to the cap, one entry per ms.
      const initial = new Map<string, CachedZapSenderProfile>();
      const oldestKeys: string[] = [];
      for (let i = 0; i < __TEST__.MAX_ENTRIES; i++) {
        const k = i.toString(16).padStart(64, '0');
        if (i < 5) oldestKeys.push(k);
        initial.set(k, profile({ name: `user-${i}` }));
      }
      // Persist each one at a distinct timestamp so eviction order is stable.
      for (const [k, p] of initial) {
        cursor += 1;
        await setMany(new Map([[k, p]]));
      }

      // Cache should be exactly full at this point.
      const raw1 = await AsyncStorage.getItem(STORAGE_KEY);
      expect(Object.keys(JSON.parse(raw1!)).length).toBe(__TEST__.MAX_ENTRIES);

      // Add 5 more — expect the 5 oldest to be evicted.
      for (let i = 0; i < 5; i++) {
        cursor += 1;
        const k = `f${i}`.padStart(64, 'f');
        await setMany(new Map([[k, profile({ name: `new-${i}` })]]));
      }

      const raw2 = await AsyncStorage.getItem(STORAGE_KEY);
      const after = JSON.parse(raw2!) as Record<string, unknown>;
      expect(Object.keys(after).length).toBe(__TEST__.MAX_ENTRIES);
      // The 5 oldest pubkeys should no longer be present.
      for (const k of oldestKeys) {
        expect(after[k]).toBeUndefined();
      }
    } finally {
      tickMock.mockRestore();
    }
  });

  it('setMany on an empty input is a no-op (no AsyncStorage write)', async () => {
    const setSpy = jest.spyOn(AsyncStorage, 'setItem');
    setSpy.mockClear();
    await setMany(new Map());
    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });
});
