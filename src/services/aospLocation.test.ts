/**
 * Unit tests for the GrapheneOS / no-Play-Services location helpers.
 *
 * The contract that matters for de-Googled devices and the bare AOSP
 * emulator is a single flag: every one-shot fix MUST pass
 * `mayShowUserSettingsDialog: false`. With the default (`true`) the
 * expo-location native module routes through the Google Play
 * `SettingsClient.checkLocationSettings()` path and rejects with
 * "unsatisfied device settings" on devices with no Play Services. These
 * tests pin that flag down so a future refactor can't silently drop it.
 */
import * as Location from 'expo-location';
import {
  DEFAULT_LOCATION_ACCURACY,
  getOneShotPosition,
  oneShotPositionOptions,
} from './aospLocation';

jest.mock('expo-location', () => ({
  __esModule: true,
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
}));

const mockedLocation = Location as jest.Mocked<typeof Location>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('oneShotPositionOptions', () => {
  it('always disables the Play-Services settings dialog', () => {
    expect(oneShotPositionOptions().mayShowUserSettingsDialog).toBe(false);
  });

  it('defaults to High accuracy (PRIORITY_HIGH_ACCURACY → GPS provider)', () => {
    expect(DEFAULT_LOCATION_ACCURACY).toBe(Location.Accuracy.High);
    expect(oneShotPositionOptions().accuracy).toBe(Location.Accuracy.High);
  });

  it('honours an explicit accuracy override while keeping the dialog off', () => {
    const opts = oneShotPositionOptions(Location.Accuracy.Balanced);
    expect(opts.accuracy).toBe(Location.Accuracy.Balanced);
    expect(opts.mayShowUserSettingsDialog).toBe(false);
  });
});

describe('getOneShotPosition', () => {
  it('calls getCurrentPositionAsync with the no-Play-dialog options', async () => {
    const fix = {
      coords: { latitude: 1, longitude: 2, accuracy: 5 },
      timestamp: 1000,
    } as Awaited<ReturnType<typeof Location.getCurrentPositionAsync>>;
    mockedLocation.getCurrentPositionAsync.mockResolvedValue(fix);

    const result = await getOneShotPosition();

    expect(result).toBe(fix);
    expect(mockedLocation.getCurrentPositionAsync).toHaveBeenCalledWith({
      accuracy: Location.Accuracy.High,
      mayShowUserSettingsDialog: false,
    });
  });

  it('forwards a custom accuracy to getCurrentPositionAsync', async () => {
    mockedLocation.getCurrentPositionAsync.mockResolvedValue(
      {} as Awaited<ReturnType<typeof Location.getCurrentPositionAsync>>,
    );

    await getOneShotPosition(Location.Accuracy.Lowest);

    expect(mockedLocation.getCurrentPositionAsync).toHaveBeenCalledWith({
      accuracy: Location.Accuracy.Lowest,
      mayShowUserSettingsDialog: false,
    });
  });

  it('propagates rejections (caller decides how to handle a failed fix)', async () => {
    mockedLocation.getCurrentPositionAsync.mockRejectedValue(new Error('no fix'));
    await expect(getOneShotPosition()).rejects.toThrow('no fix');
  });
});
