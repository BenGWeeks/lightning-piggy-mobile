import AsyncStorage from '@react-native-async-storage/async-storage';

import { EMPTY_STATE, loadWatcherState, saveWatcherState } from './watcherPushStore';

const PK = 'a'.repeat(64);
const KEY = `watcher_push_v1_${PK}`;

beforeEach(() => AsyncStorage.clear());

describe('watcherPushStore', () => {
  it('starts empty (everything off) and round-trips per account', async () => {
    await expect(loadWatcherState(PK)).resolves.toEqual(EMPTY_STATE);
    const state = {
      categories: { dm: true, zap: false, mention: true, payment: false },
      lastTs: 1_791_000_000,
      registered: {
        fingerprint: 'f',
        coreFingerprint: 'c',
        tokenHash: 't',
        platform: 'fcm' as const,
        app: 'com.lightningpiggy.app',
        at: 5,
      },
    };
    await saveWatcherState(PK, state);
    await expect(loadWatcherState(PK)).resolves.toEqual(state);
    await expect(loadWatcherState('b'.repeat(64))).resolves.toEqual(EMPTY_STATE);
  });

  it('sanitises a damaged record instead of trusting it', async () => {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({
        categories: { dm: 'yes', zap: true },
        lastTs: 'x',
        registered: { tokenHash: 1 },
      }),
    );
    await expect(loadWatcherState(PK)).resolves.toEqual({
      categories: { dm: false, zap: true, mention: false, payment: false },
      lastTs: 0,
      registered: null,
    });
    await AsyncStorage.setItem(KEY, '{not json');
    await expect(loadWatcherState(PK)).resolves.toEqual(EMPTY_STATE);
  });

  it('throws when storage cannot be read (never "nothing registered")', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('io'));
    await expect(loadWatcherState(PK)).rejects.toThrow('io');
  });
});
