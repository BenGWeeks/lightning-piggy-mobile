/** Yield to the JS event loop so UI interactions can tick between
 * chunks of a synchronous decrypt loop (#177). `await`ing an already-
 * resolved promise only drains the microtask queue, which still
 * starves UI events — setTimeout(0) returns to the task scheduler. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** ~4 ms — under a quarter of a 60 fps frame (16.6 ms). The NIP-17 inbox
 * loops aim to stay under this many ms of unbroken JS work per yield. With the
 * old count-based yield (every 4 wraps) a slow path could still
 * blow past 50–200 ms in a single burst — enough to drop several
 * frames on tab-switch. See #532. */
export const DECRYPT_FRAME_BUDGET_MS = 4;

/** Cooperative-yield scheduler for the NIP-17 inbox loops (#532).
 *
 * Two improvements over the old `if (i % N === 0) await yieldToEventLoop()`
 * pattern:
 *
 * 1. **Time-budget yields.** We only pay for a `setTimeout(0)` round-
 *    trip when wall-clock since the last yield exceeds
 *    `DECRYPT_FRAME_BUDGET_MS`. A run of cheap cache hits no longer
 *    forces a yield every Nth iteration even though there's been no
 *    blocking work. The count-based modulo still acts as a safety
 *    cap (set by the caller) so a pathological iteration that
 *    somehow underestimates its own runtime can't starve the thread.
 *
 * 2. **Hard-cancel on abort.** When the caller's `AbortSignal` fires
 *    mid-loop, an `abort` listener clears the currently-pending
 *    `setTimeout` and resolves the awaiter immediately. Without this,
 *    the loop would still drain one more `setTimeout(0)` round-trip
 *    (plus whatever sync work follows it) before the next abort
 *    check — visible as a slug of pinned-thread time after a
 *    tab-switch blurs MessagesScreen.
 *
 * Returned object:
 * - `maybeYield()` — call once per loop iteration. No-op unless the
 *   frame budget is exceeded OR the safety-cap counter ticks.
 * - `yieldCount` — number of actual yields performed (perfLog).
 * - `dispose()` — detach the abort listener after the loop exits.
 */
export type YieldScheduler = {
  maybeYield: () => Promise<void>;
  readonly yieldCount: number;
  dispose: () => void;
};

export function createYieldScheduler(opts: {
  signal?: AbortSignal;
  /** Safety cap — always yield when iteration % safetyEvery === 0,
   * even if the frame budget hasn't been blown. */
  safetyEvery: number;
  /** ms of unbroken JS work before we force a yield. */
  budgetMs?: number;
}): YieldScheduler {
  const { signal, safetyEvery, budgetMs = DECRYPT_FRAME_BUDGET_MS } = opts;
  let iteration = 0;
  let yields = 0;
  let lastYieldAt = performance.now();
  let pendingHandle: ReturnType<typeof setTimeout> | null = null;
  let pendingReject: ((reason?: unknown) => void) | null = null;

  // On abort: clear the in-flight setTimeout so the awaiter unwinds
  // immediately instead of waiting for the next scheduler tick.
  const onAbort = () => {
    if (pendingHandle !== null) {
      clearTimeout(pendingHandle);
      pendingHandle = null;
    }
    if (pendingReject) {
      const reject = pendingReject;
      pendingReject = null;
      reject(new Error('aborted'));
    }
  };
  if (signal) {
    if (signal.aborted) {
      // Already aborted before the loop started — caller is expected
      // to check signal.aborted itself, but make maybeYield a no-op
      // resolver so we don't queue work.
    } else {
      signal.addEventListener('abort', onAbort);
    }
  }

  const maybeYield = async () => {
    iteration++;
    if (signal?.aborted) return;
    const now = performance.now();
    const overBudget = now - lastYieldAt >= budgetMs;
    const safetyHit = iteration % safetyEvery === 0;
    if (!overBudget && !safetyHit) return;
    yields++;
    await new Promise<void>((resolve, reject) => {
      pendingReject = reject;
      pendingHandle = setTimeout(() => {
        pendingHandle = null;
        pendingReject = null;
        resolve();
      }, 0);
    }).catch(() => {
      // Aborted — swallow; caller checks signal.aborted after maybeYield.
    });
    lastYieldAt = performance.now();
  };

  const dispose = () => {
    if (signal) signal.removeEventListener('abort', onAbort);
    if (pendingHandle !== null) {
      clearTimeout(pendingHandle);
      pendingHandle = null;
    }
  };

  return {
    maybeYield,
    get yieldCount() {
      return yields;
    },
    dispose,
  };
}

/** Chunk size for yielding between decrypt attempts. Sized for the
 * nsec path: `nip04.decrypt` / `unwrapWrapNsec` are ~1 ms each on
 * mid-range mobile CPUs, so 15 iterations ≈ 15 ms of blocking work
 * per batch — just under a 60 fps frame budget. The Amber path uses
 * the same constant, but its decrypt is IPC-bound and already
 * yields per call, so the extra `setTimeout(0)` there is effectively
 * free. If you retune this, profile the nsec path with `Profiler`
 * in FriendsScreen as the canary. */
export const DECRYPT_YIELD_EVERY = 15;

/** Yield cadence for the kind-1059 (NIP-17 wrap) loops in
 * `refreshDmInbox`. Smaller than `DECRYPT_YIELD_EVERY` because this
 * counter ticks on EVERY wrap — cache hit, miss, follow-filter drop,
 * group-route, the lot — so even an inbox of pure cache hits still
 * yields the JS thread regularly. The cache-hit path itself is cheap
 * (~ms), but on a >1000-wrap inbox the bulk processing piles up to
 * tens of seconds of unbroken JS work without a periodic yield, which
 * starves UI events (back-tap appears frozen — #286). Lowered from 8
 * to 4 in 2026-05 — perf testing on a real Pixel showed the
 * post-cold-start "Send sheet feels frozen" window was dominated by
 * back-to-back NIP-17 inbox processing without enough JS-thread
 * breathing room for gorhom-bottom-sheet's open animation to schedule
 * frames. Halving this doubles yield frequency, drops the per-burst
 * blocking from ~8 ms to ~4 ms, and lets bottom-sheet opens stay
 * smooth during inbox drain.
 *
 * Lowered again 2026-05-16 from 4 → 2: tonight's instrumented Pixel
 * logs (issue #560) showed refreshDmInbox running for 8.6 s wall-clock
 * with 3 s heartbeat gaps stacking during the decrypt loop. Yielding
 * every 2 wraps cuts each per-burst block back to ~2 ms; the
 * setTimeout(0) cost is amortised across the still-significant
 * per-wrap decrypt work so the overhead is < 5%. */
export const NIP17_LOOP_YIELD_EVERY = 2;
