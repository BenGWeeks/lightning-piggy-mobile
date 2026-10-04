import { act, renderHook } from '@testing-library/react-native';
import { useNearbyCacheSubscription } from './useNearbyCacheSubscription';
import { subscribeNearbyCaches } from '../services/nostrPlacesPublisher';
let mockFocus: () => (() => void) | void;
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (fn: typeof mockFocus) => {
    mockFocus = fn;
  },
}));
jest.mock('../services/nostrPlacesPublisher', () => ({ subscribeNearbyCaches: jest.fn() }));
jest.mock('../utils/exploreContentFilter', () => ({ isHiddenInProd: () => false }));
beforeEach(() => jest.clearAllMocks());
it('closes on blur, ignores late events, and reopens the latest viewport on focus', () => {
  const close = jest.fn();
  jest.mocked(subscribeNearbyCaches).mockReturnValue(close);
  const enqueue = jest.fn();
  const { result } = renderHook(() => useNearbyCacheSubscription({ enqueue, flush: jest.fn() }));
  act(() => result.current.resubscribeForPrefixes(['abc']));
  expect(subscribeNearbyCaches).not.toHaveBeenCalled();
  let blur: (() => void) | void;
  act(() => {
    blur = mockFocus();
  });
  expect(subscribeNearbyCaches).toHaveBeenCalledTimes(1);
  const lateEvent = jest.mocked(subscribeNearbyCaches).mock.calls[0][1];
  act(() => {
    blur?.();
    result.current.resubscribeForPrefixes(['def']);
  });
  expect(close).toHaveBeenCalled();
  lateEvent({ coord: 'old', hiderPubkey: 'pub' } as never);
  expect(enqueue).not.toHaveBeenCalled();
  act(() => {
    mockFocus();
  });
  expect(jest.mocked(subscribeNearbyCaches).mock.calls[1][0]).toEqual(['def']);
});

it('replaces the bounded subscription when panning to a new viewport, not for reordered tiles (#1065)', () => {
  const close = jest.fn();
  jest.mocked(subscribeNearbyCaches).mockReturnValue(close);
  const enqueue = jest.fn();
  const { result } = renderHook(() => useNearbyCacheSubscription({ enqueue, flush: jest.fn() }));
  act(() => {
    mockFocus();
    result.current.resubscribeForPrefixes(['u12', 'u13']);
  });
  const oldEvent = jest.mocked(subscribeNearbyCaches).mock.calls[0][1];
  act(() => result.current.resubscribeForPrefixes(['u13', 'u12']));
  expect(subscribeNearbyCaches).toHaveBeenCalledTimes(1);
  act(() => result.current.resubscribeForPrefixes(['u35', 'u36']));
  expect(close).toHaveBeenCalledTimes(1);
  expect(subscribeNearbyCaches).toHaveBeenLastCalledWith(
    ['u35', 'u36'],
    expect.any(Function),
    undefined,
    { limit: 500 },
  );
  oldEvent({ coord: 'stale', hiderPubkey: 'pub' } as never);
  expect(enqueue).not.toHaveBeenCalled();
  const newEvent = jest.mocked(subscribeNearbyCaches).mock.calls[1][1];
  newEvent({ coord: 'denmark', hiderPubkey: 'pub' } as never);
  expect(enqueue).toHaveBeenCalledWith('denmark', expect.objectContaining({ coord: 'denmark' }));
});
