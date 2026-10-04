import { act, renderHook } from '@testing-library/react-native';
import { useConnectionTest } from './useConnectionTest';

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(global, 'clearTimeout');
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('invalidates a success immediately when its draft changes', async () => {
  const probe = jest.fn(async () => 1);
  const { result, rerender } = renderHook(
    ({ key }: { key: string }) => useConnectionTest(key, probe),
    {
      initialProps: { key: 'A' },
    },
  );
  act(() => result.current.run());
  await flush();
  expect(result.current.state.phase).toBe('success');
  rerender({ key: 'B' });
  expect(result.current.state.phase).toBe('idle');
});
it('aborts edits and ignores the old native result even after a new check succeeds', async () => {
  let oldResolve!: () => void;
  let oldSignal!: AbortSignal;
  const probe = jest.fn((signal: AbortSignal) => {
    oldSignal = signal;
    return new Promise<void>((resolve) => {
      oldResolve = resolve;
    });
  });
  const { result, rerender } = renderHook(
    ({ key }: { key: string }) => useConnectionTest(key, probe),
    {
      initialProps: { key: 'A' },
    },
  );
  act(() => result.current.run());
  await flush();
  rerender({ key: 'B' });
  expect(oldSignal.aborted).toBe(true);
  probe.mockImplementation(async () => undefined);
  act(() => result.current.run());
  await flush();
  expect(result.current.state.phase).toBe('success');
  await act(async () => {
    oldResolve();
  });
  expect(result.current.state.phase).toBe('success');
});
it('bounds the whole operation, including a response body that never finishes', async () => {
  let signal!: AbortSignal;
  let lateResolve!: () => void;
  const probe = (value: AbortSignal) => {
    signal = value;
    return new Promise<void>((resolve) => {
      lateResolve = resolve;
    });
  };
  const { result } = renderHook(() => useConnectionTest('A', probe, 100));
  act(() => result.current.run());
  await flush();
  act(() => jest.advanceTimersByTime(100));
  expect(result.current.state).toEqual({ phase: 'error', reason: 'timeout' });
  expect(signal.aborted).toBe(true);
  await act(async () => {
    lateResolve();
  });
  expect(result.current.state).toEqual({ phase: 'error', reason: 'timeout' });
  expect(clearTimeout).toHaveBeenCalled();
});
it('cancels on screen blur and unmount without allowing late errors to replace idle', async () => {
  let signal!: AbortSignal;
  const probe = (value: AbortSignal) => {
    signal = value;
    return new Promise<void>(() => undefined);
  };
  const { result, rerender, unmount } = renderHook(
    ({ active }: { active: boolean }) => useConnectionTest('A', probe, 100, active),
    { initialProps: { active: true } },
  );
  act(() => result.current.run());
  await flush();
  rerender({ active: false });
  expect(signal.aborted).toBe(true);
  expect(result.current.state.phase).toBe('idle');
  rerender({ active: true });
  act(() => result.current.run());
  await flush();
  unmount();
  expect(signal.aborted).toBe(true);
  expect(clearTimeout).toHaveBeenCalled();
});
it('allows retry after a failed check', async () => {
  const probe = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(1);
  const { result } = renderHook(() => useConnectionTest('A', probe));
  act(() => result.current.run());
  await flush();
  expect(result.current.state).toEqual({ phase: 'error', reason: 'failed' });
  act(() => result.current.run());
  await flush();
  expect(result.current.state.phase).toBe('success');
  expect(clearTimeout).toHaveBeenCalled();
});
