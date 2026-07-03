import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_NEARBY_SETTINGS,
  isWithinQuietHours,
  loadNearbySettings,
  saveNearbySettings,
} from './nearbySettingsService';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

const getItem = AsyncStorage.getItem as jest.Mock;
const setItem = AsyncStorage.setItem as jest.Mock;

describe('nearbySettingsService', () => {
  beforeEach(() => {
    getItem.mockReset();
    setItem.mockReset();
  });

  it('returns defaults on a cold install (nothing in storage)', async () => {
    getItem.mockResolvedValueOnce(null);
    expect(await loadNearbySettings()).toEqual(DEFAULT_NEARBY_SETTINGS);
  });

  it('returns defaults if the stored payload is corrupt', async () => {
    getItem.mockResolvedValueOnce('not-json');
    expect(await loadNearbySettings()).toEqual(DEFAULT_NEARBY_SETTINGS);
  });

  it('falls back to a valid radius when stored value is out of range', async () => {
    getItem.mockResolvedValueOnce(
      JSON.stringify({ enabled: true, alertRadiusMeters: 9999, quietHoursEnabled: true }),
    );
    const loaded = await loadNearbySettings();
    expect(loaded.enabled).toBe(true);
    expect(loaded.alertRadiusMeters).toBe(DEFAULT_NEARBY_SETTINGS.alertRadiusMeters);
    expect(loaded.quietHoursEnabled).toBe(true);
  });

  it('round-trips a saved payload', async () => {
    const next = { enabled: true, alertRadiusMeters: 250 as const, quietHoursEnabled: false };
    await saveNearbySettings(next);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem.mock.calls[0][1]).toBe(JSON.stringify(next));
  });
});

describe('isWithinQuietHours', () => {
  it.each([
    ['midnight', new Date(2026, 4, 10, 0, 0), true],
    ['07:59', new Date(2026, 4, 10, 7, 59), true],
    ['08:00', new Date(2026, 4, 10, 8, 0), false],
    ['noon', new Date(2026, 4, 10, 12, 0), false],
    ['21:59', new Date(2026, 4, 10, 21, 59), false],
    ['22:00', new Date(2026, 4, 10, 22, 0), true],
  ])('%s → %s', (_label, date, expected) => {
    expect(isWithinQuietHours(date)).toBe(expected);
  });
});
