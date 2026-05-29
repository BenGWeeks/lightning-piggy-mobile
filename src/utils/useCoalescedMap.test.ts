/**
 * Unit tests for the relay-event coalescing hook.
 *
 * `useCoalescedMap` batches a burst of per-item `enqueue` calls into one React
 * state commit per flush window — the cold-start perf fix shared by HuntScreen
 * and EventsScreen (audit MED 3/4). The contract worth pinning down:
 *
 *   1. A burst under the threshold commits once, after the debounce window.
 *   2. Hitting the threshold flushes early (synchronously) without waiting.
 *   3. `shouldReplace` drops stale items both while staged AND against state
 *      already committed (a late stale event can't clobber a fresher one).
 *   4. `flush()` drains the pending buffer immediately (used on sub teardown).
 *   5. `setMap` replaces committed state outright (hydrate / clear paths).
 */
import { renderHook, act } from '@testing-library/react-native';
import { useCoalescedMap } from './useCoalescedMap';

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('useCoalescedMap', () => {
  it('coalesces a sub-threshold burst into one commit after the debounce', () => {
    const { result } = renderHook(() => useCoalescedMap<number>({ flushMs: 100 }));

    // Nothing committed yet immediately after enqueue.
    act(() => {
      result.current.enqueue('a', 1);
      result.current.enqueue('b', 2);
      result.current.enqueue('c', 3);
    });
    expect(result.current.map.size).toBe(0);

    // One commit once the window elapses, carrying the whole batch.
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(result.current.map.size).toBe(3);
    expect(result.current.map.get('b')).toBe(2);
  });

  it('flushes early (synchronously) once the threshold is reached', () => {
    const { result } = renderHook(() =>
      useCoalescedMap<number>({ flushMs: 1000, flushThreshold: 3 }),
    );
    act(() => {
      result.current.enqueue('a', 1);
      result.current.enqueue('b', 2);
      // Third enqueue hits threshold → flushes without advancing timers.
      result.current.enqueue('c', 3);
    });
    expect(result.current.map.size).toBe(3);
  });

  it('drops a stale item per shouldReplace — both staged and committed', () => {
    const { result } = renderHook(() =>
      useCoalescedMap<{ v: number; ts: number }>({
        flushMs: 100,
        // Newest timestamp wins.
        shouldReplace: (existing, incoming) => incoming.ts > existing.ts,
      }),
    );

    // Staged-buffer dedupe: the older ts must not overwrite the newer one
    // before the flush.
    act(() => {
      result.current.enqueue('x', { v: 2, ts: 200 });
      result.current.enqueue('x', { v: 1, ts: 100 });
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(result.current.map.get('x')).toEqual({ v: 2, ts: 200 });

    // Committed-state dedupe: a late stale event arriving AFTER the newer one
    // was committed is dropped in the flush merge too.
    act(() => {
      result.current.enqueue('x', { v: 1, ts: 100 });
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(result.current.map.get('x')).toEqual({ v: 2, ts: 200 });
  });

  it('flush() drains the pending buffer immediately', () => {
    const { result } = renderHook(() => useCoalescedMap<number>({ flushMs: 5000 }));
    act(() => {
      result.current.enqueue('a', 1);
      result.current.flush();
    });
    expect(result.current.map.get('a')).toBe(1);
  });

  it('setMap replaces committed state outright', () => {
    const { result } = renderHook(() =>
      useCoalescedMap<number>({ initial: () => new Map([['seed', 9]]) }),
    );
    expect(result.current.map.get('seed')).toBe(9);
    act(() => {
      result.current.setMap(new Map([['fresh', 1]]));
    });
    expect(result.current.map.has('seed')).toBe(false);
    expect(result.current.map.get('fresh')).toBe(1);
  });
});
