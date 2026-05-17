/**
 * Unit tests for the live user-location hook.
 *
 * The hook is the single point of truth that PR #597 wires into every
 * map surface (Explore hub, MapScreen, PlacesScreen, EventDetailScreen,
 * PlaceDetailScreen, HuntScreen, HuntCreateScreen). Bugs here ripple
 * everywhere, so the contract is worth pinning down:
 *
 *   1. Permission denied flips `denied` and stops further work.
 *   2. The three-step ladder (last-known → current → watch) runs in
 *      order, and a fresher rung overwrites a staler one.
 *   3. Out-of-order fixes (older `LocationObject.timestamp` than the
 *      last applied) are dropped — the watch + the parallel one-shot
 *      can race.
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

const mockedLocation = Location as jest.Mocked<typeof Location>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useLiveUserLocation', () => {
  it('flips `denied` when permission is refused and stops the ladder', async () => {
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
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({
      status: 'granted',
    } as Awaited<ReturnType<typeof Location.requestForegroundPermissionsAsync>>);
    // Explicit increasing timestamps — the new race-ordering logic
    // drops any fix that's older than the last one applied.
    mockedLocation.getLastKnownPositionAsync.mockResolvedValue({
      coords: { latitude: 1, longitude: 1, accuracy: 50 },
      timestamp: 1000,
    } as Awaited<ReturnType<typeof Location.getLastKnownPositionAsync>>);
    mockedLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 2, longitude: 2, accuracy: 20 },
      timestamp: 2000,
    } as Awaited<ReturnType<typeof Location.getCurrentPositionAsync>>);

    let watchCb:
      | ((p: {
          coords: { latitude: number; longitude: number; accuracy: number };
          timestamp: number;
        }) => void)
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
      watchCb?.({ coords: { latitude: 3, longitude: 3, accuracy: 10 }, timestamp: 3000 });
    });
    expect(result.current.pos).toEqual({ lat: 3, lon: 3, accuracy: 10 });
  });

  it('drops out-of-order fixes (older timestamp than the last applied)', async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({
      status: 'granted',
    } as Awaited<ReturnType<typeof Location.requestForegroundPermissionsAsync>>);
    mockedLocation.getLastKnownPositionAsync.mockResolvedValue(null);
    mockedLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 0, longitude: 0, accuracy: 100 },
      timestamp: 5000,
    } as Awaited<ReturnType<typeof Location.getCurrentPositionAsync>>);
    let watchCb:
      | ((p: {
          coords: { latitude: number; longitude: number; accuracy: number };
          timestamp: number;
        }) => void)
      | null = null;
    mockedLocation.watchPositionAsync.mockImplementation(async (_opts, cb) => {
      watchCb = cb as typeof watchCb;
      return { remove: jest.fn() } as Location.LocationSubscription;
    });

    const { result } = renderHook(() => useLiveUserLocation());

    // Wait for the fresh fix (ts=5000) to land.
    await waitFor(() => {
      expect(result.current.pos).toEqual({ lat: 0, lon: 0, accuracy: 100 });
    });

    // Watch delivers an OLDER fix (ts=3000) — must be ignored.
    await act(async () => {
      watchCb?.({ coords: { latitude: 9, longitude: 9, accuracy: 5 }, timestamp: 3000 });
    });
    expect(result.current.pos).toEqual({ lat: 0, lon: 0, accuracy: 100 });

    // Then a newer one (ts=7000) — must be applied.
    await act(async () => {
      watchCb?.({ coords: { latitude: 1, longitude: 1, accuracy: 8 }, timestamp: 7000 });
    });
    expect(result.current.pos).toEqual({ lat: 1, lon: 1, accuracy: 8 });
  });

  it('removes the watch subscription on unmount', async () => {
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
