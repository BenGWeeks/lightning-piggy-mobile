import { act, renderHook } from '@testing-library/react-native';
import { useDebouncedMapBounds } from './useDebouncedMapBounds';
const bounds = { minLat: 1, maxLat: 2, minLon: 3, maxLon: 4 };
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
test('unmount cancels the callback that could reopen a closed relay subscription', () => {
  const subscribe = jest.fn();
  const { result, unmount } = renderHook(() => useDebouncedMapBounds(subscribe));
  const lateHandler = result.current;
  act(() => result.current(bounds));
  unmount();
  act(() => {
    lateHandler(bounds);
    jest.runAllTimers();
  });
  expect(subscribe).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
test('only the latest camera bounds reach the current callback', () => {
  const old = jest.fn();
  const current = jest.fn();
  const { result, rerender } = renderHook(
    ({ callback }: { callback: jest.Mock }) => useDebouncedMapBounds(callback),
    {
      initialProps: { callback: old },
    },
  );
  const next = { ...bounds, minLat: 0 };
  act(() => {
    result.current(bounds);
    result.current(next);
  });
  rerender({ callback: current });
  act(() => jest.advanceTimersByTime(500));
  expect(old).not.toHaveBeenCalled();
  expect(current).toHaveBeenCalledTimes(1);
  expect(current).toHaveBeenCalledWith(next);
});
