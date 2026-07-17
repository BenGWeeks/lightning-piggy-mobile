/**
 * Unit tests for the Explore-rails one-shot position hook (#1064).
 *
 * The defect this hook exists for: the rails' previous acquisition was
 * a single un-retried `getCurrentPositionAsync` — when that rejected,
 * `pos` kept the persisted cache-anchor seed for the whole session, so
 * the rails queried around wherever the user last panned a map to.
 * The contract pinned down here:
 *
 *   1. Permission denied flips `locationDenied` and stops the ladder.
 *   2. A watch first-fix rescues the session when the one-shot rejects
 *      (the #1064 wedge), and the watch is removed after that fix.
 *   3. Newest-wins ordering across the racing channels.
 *   4. Both fresh-fix channels failing with nothing landed flips
 *      `locationDenied`; a landed last-known keeps it false.
 *   5. Unmount removes a still-armed watch.
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { peekCachedAnchorSync } from '../services/btcMapService';
import { useExploreRailsPosition } from './useExploreRailsPosition';

jest.mock('expo-location', () => ({
  __esModule: true,
  requestForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3, High: 4 },
}));

jest.mock('../services/btcMapService', () => ({
  __esModule: true,
  peekCachedAnchorSync: jest.fn(() => null),
}));

const mockedLocation = Location as jest.Mocked<typeof Location>;
const mockedPeekAnchor = peekCachedAnchorSync as jest.MockedFunction<typeof peekCachedAnchorSync>;

const grant = () =>
  mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({
    status: 'granted',
  } as Awaited<ReturnType<typeof Location.requestForegroundPermissionsAsync>>);

type WatchCb = (p: {
  coords: { latitude: number; longitude: number; accuracy: number };
  timestamp: number;
}) => void;

beforeEach(() => {
  jest.clearAllMocks();
  mockedPeekAnchor.mockReturnValue(null);
});

describe('useExploreRailsPosition', () => {
  it('seeds pos from the cached anchor with a null accuracy', () => {
    mockedPeekAnchor.mockReturnValue({ lat: 52.5, lon: 5.5 });
    mockedLocation.requestForegroundPermissionsAsync.mockReturnValue(
      new Promise(() => {}) as ReturnType<typeof Location.requestForegroundPermissionsAsync>,
    );

    const { result } = renderHook(() => useExploreRailsPosition());

    expect(result.current.pos).toEqual({ lat: 52.5, lon: 5.5, accuracy: null });
  });

  it('flips `locationDenied` when permission is refused and stops the ladder', async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({
      status: 'denied',
    } as Awaited<ReturnType<typeof Location.requestForegroundPermissionsAsync>>);

    const { result } = renderHook(() => useExploreRailsPosition());

    await waitFor(() => {
      expect(result.current.locationDenied).toBe(true);
    });
    expect(result.current.pos).toBeNull();
    expect(mockedLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(mockedLocation.watchPositionAsync).not.toHaveBeenCalled();
  });

  it('nulls a seeded pos when permission is refused (no "near you" around a stale anchor)', async () => {
    mockedPeekAnchor.mockReturnValue({ lat: 52.5, lon: 5.5 });
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({
      status: 'denied',
    } as Awaited<ReturnType<typeof Location.requestForegroundPermissionsAsync>>);

    const { result } = renderHook(() => useExploreRailsPosition());

    // Seed paints first…
    expect(result.current.pos).toEqual({ lat: 52.5, lon: 5.5, accuracy: null });
    // …then the denied state clears it so downstream pos-gated work stands down.
    await waitFor(() => {
      expect(result.current.locationDenied).toBe(true);
    });
    expect(result.current.pos).toBeNull();
  });

  it('keeps the anchor seed (and does not flip denied) when both fresh channels fail', async () => {
    mockedPeekAnchor.mockReturnValue({ lat: 52.5, lon: 5.5 });
    grant();
    mockedLocation.getLastKnownPositionAsync.mockResolvedValue(null);
    mockedLocation.getCurrentPositionAsync.mockRejectedValue(new Error('timeout'));
    mockedLocation.watchPositionAsync.mockRejectedValue(new Error('no provider'));

    const { result } = renderHook(() => useExploreRailsPosition());

    // Give the async ladder time to finish failing.
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(mockedLocation.watchPositionAsync).toHaveBeenCalled();
    });

    // Stale-while-revalidate: the seeded rails stay up rather than
    // switching to the misleading "grant location" empty state.
    expect(result.current.pos).toEqual({ lat: 52.5, lon: 5.5, accuracy: null });
    expect(result.current.locationDenied).toBe(false);
  });

  it('recovers via the watch first-fix when the one-shot rejects (#1064 wedge)', async () => {
    grant();
    // The exact stuck-session shape: stale anchor seed, no last-known,
    // getCurrentPositionAsync rejects.
    mockedPeekAnchor.mockReturnValue({ lat: 52.5, lon: 5.5 });
    mockedLocation.getLastKnownPositionAsync.mockResolvedValue(null);
    mockedLocation.getCurrentPositionAsync.mockRejectedValue(new Error('timeout'));

    let watchCb: WatchCb | null = null;
    const removeMock = jest.fn();
    mockedLocation.watchPositionAsync.mockImplementation(async (_opts, cb) => {
      watchCb = cb as unknown as WatchCb;
      return { remove: removeMock } as unknown as Location.LocationSubscription;
    });

    const { result } = renderHook(() => useExploreRailsPosition());

    // Rails start on the stale seed.
    expect(result.current.pos).toEqual({ lat: 52.5, lon: 5.5, accuracy: null });
    await waitFor(() => {
      expect(mockedLocation.watchPositionAsync).toHaveBeenCalled();
    });

    // The watch delivers the real position — rails must adopt it...
    await act(async () => {
      watchCb?.({ coords: { latitude: 52.29, longitude: 0.05, accuracy: 12 }, timestamp: 2000 });
    });
    expect(result.current.pos).toEqual({ lat: 52.29, lon: 0.05, accuracy: 12 });
    expect(result.current.locationDenied).toBe(false);
    // ...and the first-fix watch stops streaming.
    expect(removeMock).toHaveBeenCalled();

    // A straggler queued before the removal took effect is ignored —
    // one publish is all the rails take from the watch channel.
    await act(async () => {
      watchCb?.({ coords: { latitude: 53.0, longitude: 1.0, accuracy: 8 }, timestamp: 3000 });
    });
    expect(result.current.pos).toEqual({ lat: 52.29, lon: 0.05, accuracy: 12 });
  });

  it('clears `locationDenied` when a very late one-shot fix finally lands', async () => {
    jest.useFakeTimers();
    try {
      grant();
      mockedLocation.getLastKnownPositionAsync.mockResolvedValue(null);
      let resolveLate: (v: Location.LocationObject) => void = () => {};
      mockedLocation.getCurrentPositionAsync.mockReturnValue(
        new Promise<Location.LocationObject>((res) => {
          resolveLate = res;
        }),
      );
      mockedLocation.watchPositionAsync.mockRejectedValue(new Error('no provider'));

      const { result } = renderHook(() => useExploreRailsPosition());

      // Stall past the bookkeeping timeout — denied flips (no seed, no fix).
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        jest.advanceTimersByTime(15_000);
      });
      expect(result.current.locationDenied).toBe(true);

      // The stalled one-shot finally resolves — the fix lands and the
      // stale denied flag clears.
      await act(async () => {
        resolveLate({
          coords: { latitude: 52.29, longitude: 0.05, accuracy: 10 },
          timestamp: 99_000,
        } as Location.LocationObject);
      });
      expect(result.current.pos).toEqual({ lat: 52.29, lon: 0.05, accuracy: 10 });
      expect(result.current.locationDenied).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('drops a watch fix older than the one-shot fix already applied', async () => {
    grant();
    mockedLocation.getLastKnownPositionAsync.mockResolvedValue(null);
    mockedLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 2, longitude: 2, accuracy: 20 },
      timestamp: 5000,
    } as Awaited<ReturnType<typeof Location.getCurrentPositionAsync>>);

    let watchCb: WatchCb | null = null;
    mockedLocation.watchPositionAsync.mockImplementation(async (_opts, cb) => {
      watchCb = cb as unknown as WatchCb;
      return { remove: jest.fn() } as unknown as Location.LocationSubscription;
    });

    const { result } = renderHook(() => useExploreRailsPosition());

    await waitFor(() => {
      expect(result.current.pos).toEqual({ lat: 2, lon: 2, accuracy: 20 });
    });

    // Stale watch fix (older timestamp) must not regress pos.
    await act(async () => {
      watchCb?.({ coords: { latitude: 9, longitude: 9, accuracy: 5 }, timestamp: 3000 });
    });
    expect(result.current.pos).toEqual({ lat: 2, lon: 2, accuracy: 20 });
  });

  it('flips `locationDenied` when both fresh-fix channels fail and nothing landed', async () => {
    grant();
    mockedLocation.getLastKnownPositionAsync.mockResolvedValue(null);
    mockedLocation.getCurrentPositionAsync.mockRejectedValue(new Error('timeout'));
    mockedLocation.watchPositionAsync.mockRejectedValue(new Error('no provider'));

    const { result } = renderHook(() => useExploreRailsPosition());

    await waitFor(() => {
      expect(result.current.locationDenied).toBe(true);
    });
    expect(result.current.pos).toBeNull();
  });

  it('flips `locationDenied` when the one-shot STALLS (never settles) and the watch fails', async () => {
    jest.useFakeTimers();
    try {
      grant();
      mockedLocation.getLastKnownPositionAsync.mockResolvedValue(null);
      // Stall: a promise that never settles — the timeout race must bound it.
      mockedLocation.getCurrentPositionAsync.mockReturnValue(
        new Promise(() => {}) as ReturnType<typeof Location.getCurrentPositionAsync>,
      );
      mockedLocation.watchPositionAsync.mockRejectedValue(new Error('no provider'));

      const { result } = renderHook(() => useExploreRailsPosition());

      // Let the permission/last-known microtasks settle, then jump past
      // the one-shot timeout.
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        jest.advanceTimersByTime(15_000);
      });

      expect(result.current.locationDenied).toBe(true);
      expect(result.current.pos).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps `locationDenied` false when last-known landed even if both fresh channels fail', async () => {
    grant();
    mockedLocation.getLastKnownPositionAsync.mockResolvedValue({
      coords: { latitude: 1, longitude: 1, accuracy: 50 },
      timestamp: 1000,
    } as Awaited<ReturnType<typeof Location.getLastKnownPositionAsync>>);
    mockedLocation.getCurrentPositionAsync.mockRejectedValue(new Error('timeout'));
    mockedLocation.watchPositionAsync.mockRejectedValue(new Error('no provider'));

    const { result } = renderHook(() => useExploreRailsPosition());

    await waitFor(() => {
      expect(result.current.pos).toEqual({ lat: 1, lon: 1, accuracy: 50 });
    });
    expect(result.current.locationDenied).toBe(false);
  });

  it('removes a still-armed watch on unmount', async () => {
    grant();
    mockedLocation.getLastKnownPositionAsync.mockResolvedValue(null);
    // One-shot resolves; the watch never fires, so it stays armed.
    mockedLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 0, longitude: 0, accuracy: 100 },
      timestamp: 1000,
    } as Awaited<ReturnType<typeof Location.getCurrentPositionAsync>>);
    const removeMock = jest.fn();
    mockedLocation.watchPositionAsync.mockResolvedValue({
      remove: removeMock,
    } as unknown as Location.LocationSubscription);

    const { unmount } = renderHook(() => useExploreRailsPosition());

    await waitFor(() => {
      expect(mockedLocation.watchPositionAsync).toHaveBeenCalled();
    });

    unmount();

    expect(removeMock).toHaveBeenCalledTimes(1);
  });
});
