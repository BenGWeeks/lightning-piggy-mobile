import { act, renderHook } from '@testing-library/react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useLiveMessageIndicator, type LiveMessageEntry } from './useLiveMessageIndicator';
const scroll = (y: number, height = 1000, viewport = 400) =>
  ({
    nativeEvent: {
      contentOffset: { y, x: 0 },
      contentSize: { height, width: 300 },
      layoutMeasurement: { height: viewport, width: 300 },
    },
  }) as NativeSyntheticEvent<NativeScrollEvent>;
const entry = (id: string, createdAt: number) => ({ id, createdAt });
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
it('follows a new message at the live edge after layout without flagging initial history', () => {
  const jump = jest.fn();
  const { result, rerender } = renderHook(
    ({ entries }: { entries: LiveMessageEntry[] }) =>
      useLiveMessageIndicator({ scope: 'a', entries, scrollToLatest: jump }),
    { initialProps: { entries: [entry('old', 10)] } },
  );
  expect(jump).not.toHaveBeenCalled();
  rerender({ entries: [entry('new', 11), entry('old', 10)] });
  act(() => jest.advanceTimersByTime(50));
  expect(jump).toHaveBeenCalledWith(true);
  expect(result.current.hasNewMessages).toBe(false);
});
it('keeps history in place, flags arrivals including equal timestamps, and clears on jump', () => {
  const jump = jest.fn();
  const { result, rerender } = renderHook(
    ({ entries }: { entries: LiveMessageEntry[] }) =>
      useLiveMessageIndicator({ scope: 'a', entries, scrollToLatest: jump }),
    { initialProps: { entries: [entry('old', 10)] } },
  );
  act(() => result.current.onScroll(scroll(500)));
  rerender({ entries: [entry('new', 10), entry('old', 10)] });
  act(() => jest.advanceTimersByTime(100));
  expect(jump).not.toHaveBeenCalled();
  expect(result.current.hasNewMessages).toBe(true);
  act(() => result.current.jumpToLatest());
  expect(jump).toHaveBeenCalledWith(true);
  expect(result.current.hasNewMessages).toBe(false);
});
it('does not flag older backfill or repeated rows and clears when manually reaching the edge', () => {
  const { result, rerender } = renderHook(
    ({ entries }: { entries: LiveMessageEntry[] }) =>
      useLiveMessageIndicator({ scope: 'a', entries, scrollToLatest: jest.fn() }),
    { initialProps: { entries: [entry('latest', 10)] } },
  );
  act(() => result.current.onScroll(scroll(500)));
  rerender({ entries: [entry('latest', 10), entry('history', 1)] });
  expect(result.current.hasNewMessages).toBe(false);
  rerender({ entries: [entry('new', 11), entry('latest', 10)] });
  expect(result.current.hasNewMessages).toBe(true);
  act(() => result.current.onScroll(scroll(0)));
  expect(result.current.hasNewMessages).toBe(false);
});
it('measures a normal group list from its end and never auto-scrolls away from history', () => {
  const jump = jest.fn();
  const { result, rerender } = renderHook(
    ({ entries }: { entries: LiveMessageEntry[] }) =>
      useLiveMessageIndicator({ scope: 'group', entries, edge: 'end', scrollToLatest: jump }),
    { initialProps: { entries: [entry('old', 1)] } },
  );
  act(() => result.current.onScroll(scroll(0)));
  rerender({ entries: [entry('old', 1), entry('new', 2)] });
  act(() => result.current.onContentSizeChange());
  expect(jump).not.toHaveBeenCalled();
  expect(result.current.hasNewMessages).toBe(true);
  act(() => result.current.onScroll(scroll(600)));
  expect(result.current.hasNewMessages).toBe(false);
  act(() => result.current.onContentSizeChange());
  expect(jump).toHaveBeenCalledWith(false);
});
it('resets the indicator and baseline on account/thread/filter changes and ignores loading hydration', () => {
  const { result, rerender } = renderHook(
    ({
      scope,
      entries,
      loading,
    }: {
      scope: string;
      entries: LiveMessageEntry[];
      loading: boolean;
    }) => useLiveMessageIndicator({ scope, entries, loading, scrollToLatest: jest.fn() }),
    { initialProps: { scope: 'a', entries: [entry('old', 1)], loading: false } },
  );
  act(() => result.current.onScroll(scroll(500)));
  rerender({ scope: 'a', entries: [entry('new', 2)], loading: false });
  expect(result.current.hasNewMessages).toBe(true);
  rerender({ scope: 'b', entries: [entry('history', 50)], loading: true });
  expect(result.current.hasNewMessages).toBe(false);
  expect(result.current.atEdge).toBe(true);
  rerender({ scope: 'b', entries: [entry('history', 50)], loading: false });
  expect(result.current.hasNewMessages).toBe(false);
  expect(result.current.atEdge).toBe(true);
});
it('cancels deferred scrolling on unmount or if the user leaves the edge', () => {
  const jump = jest.fn();
  const { result, rerender, unmount } = renderHook(
    ({ entries }: { entries: LiveMessageEntry[] }) =>
      useLiveMessageIndicator({ scope: 'a', entries, scrollToLatest: jump }),
    { initialProps: { entries: [entry('old', 1)] } },
  );
  rerender({ entries: [entry('new', 2)] });
  act(() => result.current.onScroll(scroll(500)));
  act(() => jest.advanceTimersByTime(50));
  expect(jump).not.toHaveBeenCalled();
  act(() => result.current.onScroll(scroll(0)));
  rerender({ entries: [entry('newer', 3)] });
  unmount();
  act(() => jest.advanceTimersByTime(50));
  expect(jump).not.toHaveBeenCalled();
});
