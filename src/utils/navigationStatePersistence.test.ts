import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NavigationState } from '@react-navigation/native';
import {
  NAV_STATE_KEY,
  clearPersistedNavigationState,
  loadPersistedNavigationState,
  persistNavigationState,
} from './navigationStatePersistence';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// A minimal but valid-shape NavigationState — fields React Navigation
// actually populates at runtime. The util doesn't introspect it beyond
// "is an object", so this is enough to round-trip.
const sampleState = {
  index: 0,
  key: 'stack-1',
  routeNames: ['Main'],
  routes: [{ key: 'Main-1', name: 'Main' }],
  stale: false,
  type: 'stack',
} as unknown as NavigationState;

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('navigationStatePersistence — round-trip', () => {
  it('returns undefined when nothing is saved', async () => {
    expect(await loadPersistedNavigationState()).toBeUndefined();
  });

  it('saves and loads the state', async () => {
    await persistNavigationState(sampleState);
    const loaded = await loadPersistedNavigationState();
    expect(loaded).toEqual(sampleState);
  });

  it('persists under the versioned key', async () => {
    await persistNavigationState(sampleState);
    const raw = await AsyncStorage.getItem(NAV_STATE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toMatchObject({ version: 1, state: sampleState });
  });

  it('no-ops when state is undefined', async () => {
    await persistNavigationState(undefined);
    expect(await AsyncStorage.getItem(NAV_STATE_KEY)).toBeNull();
  });
});

describe('navigationStatePersistence — clear', () => {
  it('removes the saved state', async () => {
    await persistNavigationState(sampleState);
    await clearPersistedNavigationState();
    expect(await loadPersistedNavigationState()).toBeUndefined();
  });

  it('is a no-op when nothing is saved', async () => {
    await clearPersistedNavigationState();
    expect(await loadPersistedNavigationState()).toBeUndefined();
  });
});

describe('navigationStatePersistence — defensive parsing', () => {
  it('returns undefined when the saved blob is from a prior schema', async () => {
    // Manually plant a payload with the wrong version number.
    await AsyncStorage.setItem(
      NAV_STATE_KEY,
      JSON.stringify({ version: 999, state: sampleState, savedAt: Date.now() }),
    );
    expect(await loadPersistedNavigationState()).toBeUndefined();
  });

  it('returns undefined when the saved blob is corrupt JSON', async () => {
    await AsyncStorage.setItem(NAV_STATE_KEY, '{not-json');
    expect(await loadPersistedNavigationState()).toBeUndefined();
  });

  it('returns undefined when the saved blob is structurally wrong', async () => {
    // Valid JSON, but missing required fields — the type guard rejects it.
    await AsyncStorage.setItem(NAV_STATE_KEY, JSON.stringify({ foo: 'bar' }));
    expect(await loadPersistedNavigationState()).toBeUndefined();
  });

  it('swallows AsyncStorage failures on load', async () => {
    const spy = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk full'));
    expect(await loadPersistedNavigationState()).toBeUndefined();
    spy.mockRestore();
  });

  it('swallows AsyncStorage failures on save', async () => {
    const spy = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await expect(persistNavigationState(sampleState)).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it('swallows AsyncStorage failures on clear', async () => {
    const spy = jest
      .spyOn(AsyncStorage, 'removeItem')
      .mockRejectedValueOnce(new Error('disk full'));
    await expect(clearPersistedNavigationState()).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
