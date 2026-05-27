/**
 * Unit tests for nostrDecryptPacing — the cooperative-yield scheduler
 * used by the NIP-17 inbox decrypt loop.
 *
 * Scope: verifies the RAF-based yield primitive and the abort-cancel
 * behaviour introduced in #731 (replacing the setTimeout(0) path that
 * inflated to ~90 ms under load when the Android Looper batched all
 * queued 0-ms timers into the same Choreographer frame).
 *
 * Tests are kept in the `src/contexts/` directory to satisfy the
 * Jest coverage-collection scope defined in jest.config.js.
 */

import {
  createYieldScheduler,
  yieldToEventLoop,
  DECRYPT_FRAME_BUDGET_MS,
} from './nostrDecryptPacing';

// RAF is not available in the Jest / jsdom environment. Provide a
// minimal implementation that records pending callbacks and lets tests
// flush them on demand via `flushRaf()`.
let rafCallbacks: Array<(ts: number) => void> = [];
let rafHandle = 0;

function installRafMock() {
  rafCallbacks = [];
  rafHandle = 0;
  global.requestAnimationFrame = (cb: (ts: number) => void): number => {
    rafHandle++;
    const id = rafHandle;
    rafCallbacks.push(cb);
    return id;
  };
  global.cancelAnimationFrame = (_id: number) => {
    // For simplicity, clear all pending callbacks (the scheduler only
    // ever has one pending RAF at a time).
    rafCallbacks = [];
  };
}

/** Flush all pending RAF callbacks with a fake timestamp. */
function flushRaf(ts = 0) {
  const cbs = rafCallbacks.splice(0);
  cbs.forEach((cb) => cb(ts));
}

beforeEach(() => {
  installRafMock();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// ─── yieldToEventLoop ─────────────────────────────────────────────────────────

describe('yieldToEventLoop', () => {
  it('resolves after a RAF tick (not synchronously)', async () => {
    let resolved = false;
    const p = yieldToEventLoop().then(() => {
      resolved = true;
    });

    // Not resolved yet — RAF hasn't fired.
    expect(resolved).toBe(false);

    flushRaf();
    await p;

    expect(resolved).toBe(true);
  });

  it('posts a requestAnimationFrame call (not setTimeout)', () => {
    const rafSpy = jest.spyOn(global, 'requestAnimationFrame');
    const timeoutSpy = jest.spyOn(global, 'setTimeout');

    yieldToEventLoop();

    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(timeoutSpy).not.toHaveBeenCalled();

    rafSpy.mockRestore();
    timeoutSpy.mockRestore();
  });
});

// ─── createYieldScheduler ──────────────────────────────────────────────────────

describe('createYieldScheduler', () => {
  it('does not yield when budget is not exceeded and safety cap is not hit', async () => {
    const rafSpy = jest.spyOn(global, 'requestAnimationFrame');
    // Use a very large budget so we never trigger it.
    const scheduler = createYieldScheduler({ safetyEvery: 100, budgetMs: 9999 });

    // Only 5 iterations — well below the safety cap of 100.
    for (let i = 0; i < 5; i++) {
      await scheduler.maybeYield();
    }
    scheduler.dispose();

    expect(rafSpy).not.toHaveBeenCalled();
    expect(scheduler.yieldCount).toBe(0);

    rafSpy.mockRestore();
  });

  it('yields on every safetyEvery-th iteration when budget is never exceeded', async () => {
    // Mock performance.now to return the same value so budget is never exceeded.
    const nowSpy = jest.spyOn(performance, 'now').mockReturnValue(0);
    const scheduler = createYieldScheduler({ safetyEvery: 3, budgetMs: DECRYPT_FRAME_BUDGET_MS });

    let yieldCount = 0;

    // Run 9 iterations — expect yields at i=3, 6, 9 (safetyEvery=3).
    for (let i = 0; i < 9; i++) {
      const promise = scheduler.maybeYield();
      if (rafCallbacks.length > 0) {
        // Flush the queued RAF to allow the promise to resolve.
        flushRaf();
        yieldCount++;
      }
      await promise;
    }
    scheduler.dispose();
    nowSpy.mockRestore();

    expect(yieldCount).toBe(3);
    expect(scheduler.yieldCount).toBe(3);
  });

  it('uses cancelAnimationFrame on abort (not clearTimeout)', async () => {
    const cancelRafSpy = jest.spyOn(global, 'cancelAnimationFrame');
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

    const ctrl = new AbortController();
    const scheduler = createYieldScheduler({ safetyEvery: 1, signal: ctrl.signal });

    // Trigger a yield — safetyEvery=1 so the first call yields.
    const yieldPromise = scheduler.maybeYield();

    // RAF is now queued; abort before it fires.
    ctrl.abort();

    // Wait for the aborted yield to settle.
    await yieldPromise;
    scheduler.dispose();

    expect(cancelRafSpy).toHaveBeenCalled();
    expect(clearTimeoutSpy).not.toHaveBeenCalled();

    cancelRafSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });

  it('resolves immediately after abort without waiting for RAF', async () => {
    const ctrl = new AbortController();
    const scheduler = createYieldScheduler({ safetyEvery: 1, signal: ctrl.signal });

    let settled = false;
    const yieldPromise = scheduler.maybeYield().then(() => {
      settled = true;
    });

    // RAF callback is NOT flushed — abort must bypass it.
    ctrl.abort();

    // Drain microtasks so .then() executes.
    await Promise.resolve();
    await Promise.resolve();

    await yieldPromise;
    expect(settled).toBe(true);
    scheduler.dispose();
  });

  it('dispose cancels an in-flight RAF', () => {
    // This test is synchronous — after dispose(), the in-flight promise
    // is left pending (no resolve path), so we only assert that
    // cancelAnimationFrame was called with the right kind of argument
    // rather than awaiting a never-resolving promise.
    const cancelRafSpy = jest.spyOn(global, 'cancelAnimationFrame');

    const scheduler = createYieldScheduler({ safetyEvery: 1 });

    // Trigger a yield and leave RAF unflushed.
    void scheduler.maybeYield();
    expect(rafCallbacks.length).toBe(1);

    scheduler.dispose();

    expect(cancelRafSpy).toHaveBeenCalled();
    // Clear pending callbacks so Jest doesn't warn about open handles.
    rafCallbacks = [];

    cancelRafSpy.mockRestore();
  });

  it('increments yieldCount only for actual yields', async () => {
    const nowSpy = jest.spyOn(performance, 'now').mockReturnValue(0);
    const scheduler = createYieldScheduler({ safetyEvery: 5, budgetMs: 9999 });

    // 4 iterations — none hit the safety cap (safetyEvery=5).
    for (let i = 0; i < 4; i++) {
      await scheduler.maybeYield();
    }
    expect(scheduler.yieldCount).toBe(0);

    // 5th iteration — hits the safety cap.
    const p = scheduler.maybeYield();
    flushRaf();
    await p;
    expect(scheduler.yieldCount).toBe(1);

    scheduler.dispose();
    nowSpy.mockRestore();
  });
});
