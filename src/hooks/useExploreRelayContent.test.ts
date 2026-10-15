import { act, renderHook } from '@testing-library/react-native';
import type { ParsedCache } from '../services/nostrPlacesService';
import type { NearbyCachesCompletion } from '../services/nostrPlacesPublisher';
import { useExploreRelayContent } from './useExploreRelayContent';

const mockSubscribeCaches = jest.fn();
const mockClose = jest.fn();
const mockIsTrusted = jest.fn(() => true);
let mockSeed: ParsedCache[] = [];

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, [effect]);
  },
}));
jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({ pubkey: null, relays: [] }),
}));
jest.mock('../contexts/TrustGraphContext', () => ({
  useTrustGraph: () => ({ isTrusted: mockIsTrusted }),
}));
jest.mock('../services/nostrPlacesPublisher', () => ({
  subscribeNearbyCaches: (...args: unknown[]) => mockSubscribeCaches(...args),
  subscribeNearbyEvents: () => jest.fn(),
}));
jest.mock('../services/nostrPlacesStorage', () => ({
  peekCachedCachesSync: () => mockSeed,
  peekCachedEventsSync: () => [],
  loadCachedCaches: async () => [],
  loadCachedEvents: async () => [],
}));
jest.mock('./useExplorePlacesPersist', () => ({
  usePersistCaches: jest.fn(),
  usePersistEvents: jest.fn(),
}));
jest.mock('../utils/exploreContentFilter', () => ({
  isHiddenInProd: (pubkey: string) => pubkey === 'hidden-in-prod',
  visibleCaches: (caches: ParsedCache[]) =>
    caches.filter((cache) => cache.hiderPubkey !== 'hidden-in-prod'),
  visibleEvents: () => [],
}));

const pos = { lat: 51.5, lon: -0.1, accuracy: null };
const cache = {
  coord: 'cache',
  createdAt: 1,
  hiderPubkey: 'hider',
  geohash: 'gcpuv',
} as ParsedCache;
const callbacks = (index = 0) => ({
  event: mockSubscribeCaches.mock.calls[index][1] as (cache: ParsedCache) => void,
  complete: mockSubscribeCaches.mock.calls[index][4] as (result: NearbyCachesCompletion) => void,
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockSeed = [];
  mockIsTrusted.mockReturnValue(true);
  mockSubscribeCaches.mockReturnValue(mockClose);
});
afterEach(() => jest.useRealTimers());

it('derives loading → empty from query completion', async () => {
  const { result } = renderHook(() => useExploreRelayContent(pos, 0));
  await act(async () => {});
  expect(result.current.cacheRailState).toBe('loading');
  act(() => callbacks().complete({ allRelaysFailed: false }));
  expect(result.current.cacheRailState).toBe('empty');
});

it('flushes coalesced caches at completion and accepts late content after empty', async () => {
  const { result } = renderHook(() => useExploreRelayContent(pos, 0));
  await act(async () => {});
  act(() => {
    callbacks().event(cache);
    callbacks().complete({ allRelaysFailed: false });
  });
  expect(result.current.cacheRailState).toBe('ready');
  expect(result.current.sortedCaches[0].cache).toEqual(cache);
});

it('turns a completed empty query ready when a late event arrives', async () => {
  const { result } = renderHook(() => useExploreRelayContent(pos, 0));
  await act(async () => {});
  act(() => callbacks().complete({ allRelaysFailed: false }));
  expect(result.current.cacheRailState).toBe('empty');
  act(() => {
    callbacks().event(cache);
    jest.advanceTimersByTime(100);
  });
  expect(result.current.cacheRailState).toBe('ready');
});

it('resets on retry and ignores completion from the previous query', async () => {
  const { result, rerender } = renderHook(
    ({ key }: { key: number }) => useExploreRelayContent(pos, key),
    {
      initialProps: { key: 0 },
    },
  );
  await act(async () => {});
  act(() => callbacks().complete({ allRelaysFailed: true }));
  expect(result.current.cacheRailState).toBe('error');
  rerender({ key: 1 });
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect(result.current.cacheRailState).toBe('loading');
  act(() => callbacks(0).complete({ allRelaysFailed: true }));
  expect(result.current.cacheRailState).toBe('loading');
  act(() => callbacks(1).complete({ allRelaysFailed: false }));
  expect(result.current.cacheRailState).toBe('empty');
});

it('keeps visible disk content ready even if every relay fails', async () => {
  mockSeed = [cache];
  const { result } = renderHook(() => useExploreRelayContent(pos, 0));
  await act(async () => {});
  expect(result.current.cacheRailState).toBe('ready');
  act(() => callbacks().complete({ allRelaysFailed: true }));
  expect(result.current.cacheRailState).toBe('ready');
});

it('derives state from the actual radius-filtered rail, not raw cached count', async () => {
  mockSeed = [{ ...cache, geohash: 'u4pru' }];
  const { result } = renderHook(() => useExploreRelayContent(pos, 0, 1000));
  await act(async () => {});
  expect(result.current.caches.size).toBe(1);
  expect(result.current.sortedCaches).toHaveLength(0);
  expect(result.current.cacheRailState).toBe('loading');
  act(() => callbacks().complete({ allRelaysFailed: true }));
  expect(result.current.cacheRailState).toBe('error');
});

it('keeps loading for filtered events then shows empty with the hidden count', async () => {
  mockIsTrusted.mockReturnValue(false);
  const { result } = renderHook(() => useExploreRelayContent(pos, 0));
  await act(async () => {});
  act(() => {
    callbacks().event(cache);
    jest.advanceTimersByTime(100);
  });
  expect(result.current.cacheRailState).toBe('loading');
  act(() => callbacks().complete({ allRelaysFailed: false }));
  expect(result.current.cacheRailState).toBe('empty');
  expect(result.current.untrustedCacheCount).toBe(1);
});

it('does not query or load forever without a location', async () => {
  const { result } = renderHook(() => useExploreRelayContent(null, 0));
  await act(async () => {});
  expect(mockSubscribeCaches).not.toHaveBeenCalled();
  expect(result.current.cacheRailState).toBe('empty');
});
