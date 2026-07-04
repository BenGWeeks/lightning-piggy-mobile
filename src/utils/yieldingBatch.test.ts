/**
 * Unit tests for `yieldMacrotask` — the cold-start macro-task yield used by
 * the NIP-17 DM-inbox decrypt loop (#788).
 *
 * Scope: pure scheduling. These tests assert that the cold-start primitive
 * (a) yields via `setTimeout(0)` (NOT `requestAnimationFrame`, which starves
 * during cold start), and (b) is abort-aware — it must not strand the decrypt
 * loop on a pending timer when the user blurs / unmounts mid-refresh.
 */

import { yieldMacrotask } from './yieldingBatch';

describe('yieldMacrotask', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not resolve synchronously — it waits for a macro-task', async () => {
    let resolved = false;
    const p = yieldMacrotask().then(() => {
      resolved = true;
    });

    // Microtask drain alone must NOT resolve it — a setTimeout(0) macro-task
    // is strictly later than the microtask queue.
    await Promise.resolve();
    expect(resolved).toBe(false);

    jest.runOnlyPendingTimers();
    await p;
    expect(resolved).toBe(true);
  });

  it('posts a setTimeout (cold start) — NOT requestAnimationFrame', () => {
    const timeoutSpy = jest.spyOn(global, 'setTimeout');
    const rafSpy =
      typeof global.requestAnimationFrame === 'function'
        ? jest.spyOn(global, 'requestAnimationFrame')
        : null;

    yieldMacrotask();

    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    if (rafSpy) expect(rafSpy).not.toHaveBeenCalled();

    timeoutSpy.mockRestore();
    rafSpy?.mockRestore();
  });

  it('resolves immediately (no timer queued) when the signal is already aborted', () => {
    const timeoutSpy = jest.spyOn(global, 'setTimeout');
    const ctrl = new AbortController();
    ctrl.abort();

    const p = yieldMacrotask(ctrl.signal);

    // No timer should have been scheduled at all.
    expect(timeoutSpy).not.toHaveBeenCalled();
    timeoutSpy.mockRestore();

    // And the promise resolves without needing a timer flush.
    return expect(p).resolves.toBeUndefined();
  });

  it('clears the pending timer and resolves early when aborted mid-wait', async () => {
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    const ctrl = new AbortController();

    let resolved = false;
    const p = yieldMacrotask(ctrl.signal).then(() => {
      resolved = true;
    });

    // Abort BEFORE the timer fires — the loop must resume promptly so it can
    // hit its own signal.aborted check, not wait out the tick.
    ctrl.abort();
    await p;

    expect(resolved).toBe(true);
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('resolves normally when the timer fires before any abort', async () => {
    const ctrl = new AbortController();
    let resolved = false;
    const p = yieldMacrotask(ctrl.signal).then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);
    jest.runOnlyPendingTimers();
    await p;
    expect(resolved).toBe(true);
  });

  it('removes its abort listener on normal fire — no accumulation across yields (#789 review)', async () => {
    // The decrypt loop calls this many times on ONE long-lived signal; a leaked
    // listener per yield means a later abort fans out to thousands of stale
    // handlers. add/remove must stay balanced.
    const ctrl = new AbortController();
    const addSpy = jest.spyOn(ctrl.signal, 'addEventListener');
    const removeSpy = jest.spyOn(ctrl.signal, 'removeEventListener');

    for (let i = 0; i < 5; i++) {
      const p = yieldMacrotask(ctrl.signal);
      jest.runOnlyPendingTimers();
      await p;
    }

    expect(addSpy).toHaveBeenCalledTimes(5);
    expect(removeSpy).toHaveBeenCalledTimes(5); // each normal fire cleans up its own listener
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
