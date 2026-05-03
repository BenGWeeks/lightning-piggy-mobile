/**
 * Coverage for the AsyncStorage-backed Learn-progress store. The pure
 * helpers (isMissionComplete / getCourseCompletedCount / isCourseComplete)
 * don't touch storage at all so they're tested directly; the async
 * read/write helpers get the official AsyncStorage jest mock.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getCourseCompletedCount,
  getProgress,
  isCourseComplete,
  isMissionComplete,
  markMissionComplete,
  markMissionIncomplete,
} from './learnProgressService';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run before ESM imports are hoisted; require is the canonical form.
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('getProgress', () => {
  it('returns an empty progress object on first run', async () => {
    expect(await getProgress()).toEqual({ completedMissions: [] });
  });

  it('returns the parsed payload when present', async () => {
    await AsyncStorage.setItem(
      'learn_progress',
      JSON.stringify({ completedMissions: ['m1', 'm2'] }),
    );
    expect(await getProgress()).toEqual({ completedMissions: ['m1', 'm2'] });
  });

  it('rejects malformed payloads and returns the empty default', async () => {
    // Schema-shape guard: anything missing `completedMissions` array
    // is treated as no-progress so the UI doesn't blow up.
    await AsyncStorage.setItem('learn_progress', JSON.stringify({ junk: true }));
    expect(await getProgress()).toEqual({ completedMissions: [] });
  });

  it('returns the empty default on JSON parse failure', async () => {
    // Silence the expected console.warn so the test output stays clean —
    // the warn is a deliberate part of the function under test, but
    // surfacing it on a passing case clutters CI logs.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await AsyncStorage.setItem('learn_progress', 'not json{{{');
      expect(await getProgress()).toEqual({ completedMissions: [] });
    } finally {
      warn.mockRestore();
    }
  });
});

describe('markMissionComplete', () => {
  it('adds a new mission id to the persisted list', async () => {
    const out = await markMissionComplete('m1');
    expect(out.completedMissions).toEqual(['m1']);
    const round = await getProgress();
    expect(round.completedMissions).toEqual(['m1']);
  });

  it('is idempotent — re-marking the same mission does not duplicate it', async () => {
    await markMissionComplete('m1');
    const out = await markMissionComplete('m1');
    expect(out.completedMissions).toEqual(['m1']);
  });
});

describe('markMissionIncomplete', () => {
  it('removes an existing mission id from the persisted list', async () => {
    await markMissionComplete('m1');
    await markMissionComplete('m2');
    const out = await markMissionIncomplete('m1');
    expect(out.completedMissions).toEqual(['m2']);
  });

  it('is a no-op when the mission was never completed', async () => {
    const out = await markMissionIncomplete('never');
    expect(out.completedMissions).toEqual([]);
  });
});

describe('pure helpers', () => {
  it('isMissionComplete checks list membership', () => {
    const p = { completedMissions: ['m1', 'm2'] };
    expect(isMissionComplete(p, 'm1')).toBe(true);
    expect(isMissionComplete(p, 'm9')).toBe(false);
  });

  it('getCourseCompletedCount counts intersected missions', () => {
    const p = { completedMissions: ['m1', 'm3'] };
    expect(getCourseCompletedCount(p, ['m1', 'm2', 'm3', 'm4'])).toBe(2);
    expect(getCourseCompletedCount(p, [])).toBe(0);
  });

  it('isCourseComplete is true only when every mission is completed', () => {
    const p = { completedMissions: ['m1', 'm2'] };
    expect(isCourseComplete(p, ['m1', 'm2'])).toBe(true);
    expect(isCourseComplete(p, ['m1', 'm2', 'm3'])).toBe(false);
    // Empty course is vacuously complete.
    expect(isCourseComplete(p, [])).toBe(true);
  });
});
