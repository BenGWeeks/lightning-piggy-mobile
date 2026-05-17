/**
 * Unit tests for the live user-location hook.
 *
 * The hook is the single point of truth that PR #597 wires into every
 * map surface (Explore hub, MapScreen, PlacesScreen, EventDetailScreen,
 * PlaceDetailScreen, HuntScreen, HuntCreateScreen). Bugs here ripple
 * everywhere, so the contract is worth pinning down:
 *
 *   1. Dev-pinned position short-circuits the GPS ladder — emulator
 *      parity should NEVER touch hardware GPS even if the env vars
 *      are set.
 *   2. Permission denied flips `denied` and stops further work.
 *   3. The three-step ladder (last-known → current → watch) runs in
 *      order, and a fresher rung overwrites a staler one.
 *   4. Unmounting tears down the watch subscription so we don't leak
 *      a background fix-stream across navigation.
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { useLiveUserLocation } from './useLiveUserLocation';

jest.mock('expo-location', () => ({
  __esModule: true,
  requestForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3, High: 4 },
}));

jest.mock('../utils/devLocation', () => ({
  __esModule: true,
  getDevPinnedLocation: jest.fn(),
}));

import { getDevPinnedLocation } from '../utils/devLocation';

const mockedLocation = Location as jest.Mocked<typeof Location>;
const mockedDevPin = getDevPinnedLocation as jest.MockedFunction<typeof getDevPinnedLocation>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useLiveUserLocation', () => {
  it('surfaces a dev-pinned position immediately and skips the GPS ladder', async () => {
    mockedDevPin.mockReturnValue({ lat: 51.5, lon: -0.1 });

    const { result } = renderHook(() => useLiveUserLocation());

    await waitFor(() => {
      expect(result.current.pos).toEqual({ lat: 51.5, lon: -0.1, accuracy: null });
    });

    // No GPS calls should have been made when a dev pin is configured.
    expect(mockedLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mockedLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(mockedLocation.watchPositionAsync).not.toHaveBeenCalled();
  });

  it('flips `denied` when permission is refused and stops the ladder', async () => {
    mockedDevPin.mockReturnValue(null);
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({
      status: 'denied',
    } as Awaited<ReturnType<typeof Location.requestForegroundPermissionsAsync>>);

    const { result } = renderHook(() => useLiveUserLocation());

    await waitFor(() => {
      expect(result.current.denied).toBe(true);
    });
    expect(result.current.pos).toBeNull();
    expect(mockedLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(mockedLocation.watchPositionAsync).not.toHaveBeenCalled();
  });

  it('walks the ladder: last-known → current → watch, each overwriting the last', async () => {
    mockedDevPin.mockReturnValue(null);
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({
      status: 'granted',
    } as Awaited<ReturnType<typeof Location.requestForegroundPermissionsAsync>>);
    mockedLocation.getLastKnownPositionAsync.mockResolvedValue({
      coords: { latitude: 1, longitude: 1, accuracy: 50 },
    } as Awaited<ReturnType<typeof Location.getLastKnownPositionAsync>>);
    mockedLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 2, longitude: 2, accuracy: 20 },
    } as Awaited<ReturnType<typeof Location.getCurrentPositionAsync>>);

    let watchCb:
      | ((p: { coords: { latitude: number; longitude: number; accuracy: number } }) => void)
      | null = null;
    const removeMock = jest.fn();
    mockedLocation.watchPositionAsync.mockImplementation(async (_opts, cb) => {
      watchCb = cb as typeof watchCb;
      return { remove: removeMock } as Location.LocationSubscription;
    });

    const { result } = renderHook(() => useLiveUserLocation());

    // Eventually the fresh fix lands.
    await waitFor(() => {
      expect(result.current.pos).toEqual({ lat: 2, lon: 2, accuracy: 20 });
    });
    expect(mockedLocation.watchPositionAsync).toHaveBeenCalled();

    // Watch fires — the dot moves.
    await act(async () => {
      watchCb?.({ coords: { latitude: 3, longitude: 3, accuracy: 10 } });
    });
    expect(result.current.pos).toEqual({ lat: 3, lon: 3, accuracy: 10 });
  });

  it('removes the watch subscription on unmount', async () => {
    mockedDevPin.mockReturnValue(null);
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({
      status: 'granted',
    } as Awaited<ReturnType<typeof Location.requestForegroundPermissionsAsync>>);
    mockedLocation.getLastKnownPositionAsync.mockResolvedValue(null);
    mockedLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 0, longitude: 0, accuracy: 100 },
    } as Awaited<ReturnType<typeof Location.getCurrentPositionAsync>>);
    const removeMock = jest.fn();
    mockedLocation.watchPositionAsync.mockResolvedValue({
      remove: removeMock,
    } as unknown as Location.LocationSubscription);

    const { unmount } = renderHook(() => useLiveUserLocation());

    await waitFor(() => {
      expect(mockedLocation.watchPositionAsync).toHaveBeenCalled();
    });

    unmount();

    expect(removeMock).toHaveBeenCalledTimes(1);
  });
});
