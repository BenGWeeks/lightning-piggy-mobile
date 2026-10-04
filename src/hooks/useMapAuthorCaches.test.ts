import { act, renderHook } from '@testing-library/react-native';
import { useMapAuthorCaches } from './useMapAuthorCaches';
import { fetchCachesByAuthor } from '../services/nostrPlacesPublisher';
import type { ParsedCache } from '../services/nostrPlacesService';

let mockFocus: () => (() => void) | void;
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (fn: typeof mockFocus) => {
    mockFocus = fn;
  },
}));
jest.mock('../services/nostrPlacesPublisher', () => ({ fetchCachesByAuthor: jest.fn() }));

const readRelay = { read: true, url: 'wss://relay.example' };
const oldCache = { coord: '37516:pub:piggy_test', createdAt: 1, geohash: 'u1219' } as ParsedCache;
const movedCache = { ...oldCache, createdAt: 2, geohash: 'u3b00' };

beforeEach(() => jest.clearAllMocks());

it('refetches on return from Edit and merges the moved listing under the same coord', async () => {
  jest
    .mocked(fetchCachesByAuthor)
    .mockResolvedValueOnce([oldCache])
    .mockResolvedValueOnce([movedCache]);
  const enqueue = jest.fn();
  const flush = jest.fn();
  renderHook(() => useMapAuthorCaches({ pubkey: 'pub', relays: [readRelay], enqueue, flush }));
  let blur: (() => void) | void;
  await act(async () => {
    blur = mockFocus();
  });
  expect(enqueue).toHaveBeenLastCalledWith(oldCache.coord, oldCache);
  act(() => blur?.());
  await act(async () => {
    mockFocus();
  });
  expect(fetchCachesByAuthor).toHaveBeenCalledTimes(2);
  expect(enqueue).toHaveBeenLastCalledWith(oldCache.coord, movedCache);
  expect(flush).toHaveBeenCalledTimes(2);
});

it('ignores a fetch completing after blur and still fetches again on re-entry', async () => {
  let finish!: (caches: ParsedCache[]) => void;
  jest
    .mocked(fetchCachesByAuthor)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValueOnce([movedCache]);
  const enqueue = jest.fn();
  const flush = jest.fn();
  renderHook(() => useMapAuthorCaches({ pubkey: 'pub', relays: [], enqueue, flush }));
  let blur: (() => void) | void;
  act(() => {
    blur = mockFocus();
  });
  act(() => blur?.());
  await act(async () => {
    mockFocus();
  });
  await act(async () => {
    finish([oldCache]);
  });
  expect(enqueue).toHaveBeenCalledTimes(1);
  expect(enqueue).toHaveBeenCalledWith(movedCache.coord, movedCache);
  expect(fetchCachesByAuthor).toHaveBeenCalledWith('pub', undefined);
});

it('keeps the focus callback stable for equivalent relay arrays, but updates for a new read set', () => {
  const enqueue = jest.fn();
  const flush = jest.fn();
  const otherRelay = { read: true, url: 'wss://other.example' };
  const { rerender } = renderHook(
    ({ relays }: { relays: { read: boolean; url: string }[] }) =>
      useMapAuthorCaches({ pubkey: 'pub', relays, enqueue, flush }),
    { initialProps: { relays: [readRelay, otherRelay] } },
  );
  const initialFocus = mockFocus;
  rerender({
    relays: [otherRelay, { ...readRelay }, readRelay, { read: false, url: 'wss://write.example' }],
  });
  expect(mockFocus).toBe(initialFocus);
  rerender({ relays: [otherRelay] });
  expect(mockFocus).not.toBe(initialFocus);
});

it('does not query when signed out and keeps current pins on relay errors', async () => {
  const enqueue = jest.fn();
  const flush = jest.fn();
  const { rerender } = renderHook(
    ({ pubkey }: { pubkey: string | null }) =>
      useMapAuthorCaches({ pubkey, relays: [], enqueue, flush }),
    { initialProps: { pubkey: null as string | null } },
  );
  act(() => {
    mockFocus();
  });
  expect(fetchCachesByAuthor).not.toHaveBeenCalled();
  jest.mocked(fetchCachesByAuthor).mockRejectedValue(new Error('offline'));
  rerender({ pubkey: 'pub' });
  await act(async () => {
    mockFocus();
  });
  expect(enqueue).not.toHaveBeenCalled();
  expect(flush).not.toHaveBeenCalled();
});
