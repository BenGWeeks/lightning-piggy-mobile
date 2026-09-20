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
