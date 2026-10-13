import { loadShopAlertStatus } from './shopAlertStatus';
import { loadNearbySettings, DEFAULT_NEARBY_SETTINGS } from './nearbySettingsService';
import { isGeofencingActive } from './geofenceService';

jest.mock('./nearbySettingsService', () => ({
  ...jest.requireActual('./nearbySettingsService'),
  loadNearbySettings: jest.fn(),
}));
jest.mock('./geofenceService', () => ({ isGeofencingActive: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

it.each([
  [true, false, false], // Failed re-registration: preference stays on, task is stopped.
  [true, true, true],
  [false, true, false],
  [false, false, false],
])('saved enabled=%s, task active=%s reports alerts on=%s', async (enabled, active, expected) => {
  jest.mocked(loadNearbySettings).mockResolvedValue({ ...DEFAULT_NEARBY_SETTINGS, enabled });
  jest.mocked(isGeofencingActive).mockResolvedValue(active);

  expect(await loadShopAlertStatus()).toBe(expected);
  expect(loadNearbySettings).toHaveBeenCalledTimes(1);
  expect(isGeofencingActive).toHaveBeenCalledTimes(1);
});

it('reads the runtime status again after a successful registration has stopped', async () => {
  jest.mocked(loadNearbySettings).mockResolvedValue({ ...DEFAULT_NEARBY_SETTINGS, enabled: true });
  jest.mocked(isGeofencingActive).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

  expect(await loadShopAlertStatus()).toBe(true);
  expect(await loadShopAlertStatus()).toBe(false);
});
