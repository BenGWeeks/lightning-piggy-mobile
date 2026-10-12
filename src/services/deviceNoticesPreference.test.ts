import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  __resetForTests,
  loadDeviceNoticesEnabled,
  saveDeviceNoticesEnabled,
  subscribeDeviceNoticesEnabled,
} from './deviceNoticesPreference';

// Read lazily (a getter), so each test can switch the build variant.
const mockApp = { applicationId: 'com.lightningpiggy.app.preview' };
jest.mock('expo-application', () => ({
  get applicationId() {
    return mockApp.applicationId;
  },
}));

beforeEach(async () => {
  __resetForTests();
  await AsyncStorage.clear();
});

describe('deviceNoticesPreference', () => {
  it('defaults ON in dev / preview builds', async () => {
    mockApp.applicationId = 'com.lightningpiggy.app.preview';
    expect(await loadDeviceNoticesEnabled()).toBe(true);
    __resetForTests();
    mockApp.applicationId = 'com.lightningpiggy.app.dev';
    expect(await loadDeviceNoticesEnabled()).toBe(true);
  });

  it('defaults OFF in the store build', async () => {
    mockApp.applicationId = 'com.lightningpiggy.app';
    expect(await loadDeviceNoticesEnabled()).toBe(false);
  });

  it('an explicit choice wins over the default and is announced', async () => {
    mockApp.applicationId = 'com.lightningpiggy.app';
    const seen: boolean[] = [];
    const unsubscribe = subscribeDeviceNoticesEnabled((v) => seen.push(v));
    await saveDeviceNoticesEnabled(true);
    __resetForTests();
    expect(await loadDeviceNoticesEnabled()).toBe(true);
    unsubscribe();
    await saveDeviceNoticesEnabled(false);
    expect(seen).toEqual([true]);
  });
});
