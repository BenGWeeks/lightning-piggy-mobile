import { act, renderHook } from '@testing-library/react-native';
import { usePullToRefresh, type Refresher } from './usePullToRefresh';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const setup = (opts?: Parameters<typeof usePullToRefresh>[1]) => {
  const onError = jest.fn();
  const h = renderHook(() => usePullToRefresh(onError, opts));
  return { h, onError };
};

it('runs every registered refresher and stops the spinner when they finish', async () => {
  const { h, onError } = setup();
  const a = jest.fn<Promise<void>, [AbortSignal]>(() => Promise.resolve());
  const b = jest.fn<Promise<void>, [AbortSignal]>(() => Promise.resolve());
  act(() => {
    h.result.current.register(a);
    h.result.current.register(b);
  });
  act(() => h.result.current.onRefresh());
  expect(h.result.current.refreshing).toBe(true);
  await act(async () => {});
  expect(a).toHaveBeenCalledTimes(1);
  expect(b).toHaveBeenCalledTimes(1);
  expect(h.result.current.refreshing).toBe(false);
  expect(onError).not.toHaveBeenCalled();
});

it('reports a failed refresher once', async () => {
  const { h, onError } = setup();
  act(() => {
    h.result.current.register(() => Promise.reject(new Error('relays down')));
  });
  act(() => h.result.current.onRefresh());
  await act(async () => {});
  expect(onError).toHaveBeenCalledTimes(1);
  expect(h.result.current.refreshing).toBe(false);
});

it('times out, aborts the refreshers and reports the failure', async () => {
  const { h, onError } = setup({ timeoutMs: 8000 });
  let seen: AbortSignal | undefined;
  const hang: Refresher = (signal) => {
    seen = signal;
    return new Promise(() => {});
  };
  act(() => {
    h.result.current.register(hang);
  });
  act(() => h.result.current.onRefresh());
  await act(async () => {
    jest.advanceTimersByTime(7999);
  });
  expect(h.result.current.refreshing).toBe(true);
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(onError).toHaveBeenCalledTimes(1);
  expect(seen?.aborted).toBe(true);
  expect(h.result.current.refreshing).toBe(false);
});

it('ignores a second pull while one is in flight, and unregistered refreshers', async () => {
  const { h } = setup();
  const r = jest.fn<Promise<void>, [AbortSignal]>(() => new Promise(() => {}));
  const gone = jest.fn<Promise<void>, [AbortSignal]>(() => Promise.resolve());
  let unregister = () => {};
  act(() => {
    h.result.current.register(r);
    unregister = h.result.current.register(gone);
  });
  act(() => unregister());
  act(() => h.result.current.onRefresh());
  act(() => h.result.current.onRefresh());
  expect(r).toHaveBeenCalledTimes(1);
  expect(gone).not.toHaveBeenCalled();
});

it('does nothing when disabled', () => {
  const { h } = setup({ enabled: false });
  const r = jest.fn<Promise<void>, [AbortSignal]>(() => Promise.resolve());
  act(() => {
    h.result.current.register(r);
  });
  act(() => h.result.current.onRefresh());
  expect(h.result.current.enabled).toBe(false);
  expect(h.result.current.refreshing).toBe(false);
  expect(r).not.toHaveBeenCalled();
});

it('leaving the page cancels the refresh without an error toast', async () => {
  const { h, onError } = setup();
  let seen: AbortSignal | undefined;
  act(() => {
    h.result.current.register((signal) => {
      seen = signal;
      return new Promise(() => {});
    });
  });
  act(() => h.result.current.onRefresh());
  h.unmount();
  await act(async () => {
    jest.advanceTimersByTime(10_000);
  });
  expect(seen?.aborted).toBe(true);
  expect(onError).not.toHaveBeenCalled();
});
