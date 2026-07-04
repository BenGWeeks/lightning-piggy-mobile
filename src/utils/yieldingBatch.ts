/**
 * Cold-start macro-task yield for the NIP-17 DM-inbox decrypt loop (#788).
 *
 * ## Why this exists (and why it isn't just `createYieldScheduler`'s RAF path)
 *
 * `nostrDecryptPacing.createYieldScheduler` yields via `requestAnimationFrame`.
 * That is the right primitive for the WARM path (tab-switch, pull-to-refresh):
 * RAF rides the Choreographer vsync signal, so the JS thread genuinely returns
 * to native between iterations and the per-yield overhead is amortised. The
 * `setTimeout(0)` path was deliberately removed from the warm loop in #731
 * because, when a loop re-enqueues a 0 ms timer on EVERY iteration, the Android
 * Looper batches all the queued timers into a single `callTimers` bridge hop
 * and the "yield" inflates to ~90 ms — worse than not yielding.
 *
 * Cold start is the OPPOSITE failure mode (#788). At ~T+4.5–6.3 s the app is
 * still settling: the Choreographer is not producing steady vsync frames yet,
 * so RAF callbacks get coalesced/delayed and the decrypt loop runs long
 * synchronous stretches between actual yields — Stev.ie measured 1.4–2.1 s
 * heartbeat gaps coinciding with the gift-wrap decrypt pass. A `setTimeout(0)`
 * macro-task, by contrast, always drains on the next event-loop tick whether or
 * not vsync is ticking, so it reliably returns control to native (touch /
 * render) between chunks during cold start.
 *
 * The #731 timer-flood is avoided by the caller's frame-budget gate
 * (`createYieldScheduler` only actually yields once per ~`DECRYPT_FRAME_BUDGET_MS`
 * of work, not once per wrap), so even on the cold path the timer count stays
 * low — nowhere near the 83-timers-per-frame regime that triggered the Looper
 * batching in #731.
 *
 * ## What this does NOT change
 *
 * This is pure SCHEDULING. It performs no cryptography, no dedup, no ordering —
 * it only decides when the loop hands the thread back to native. Swapping the
 * warm RAF yield for this cold-start macro-task yield cannot change decryption
 * correctness; only the cadence of yields differs.
 */

/**
 * Yield a single macro-task so the native event loop (touch dispatch, render,
 * layout) can run before the next chunk of decrypt work. Uses `setTimeout(0)`
 * deliberately — unlike `requestAnimationFrame` it does not depend on the
 * Choreographer producing a vsync frame, which is exactly the cold-start
 * condition where RAF starves (#788).
 *
 * Abort-aware: resolves immediately (without queueing a timer) if `signal` is
 * already aborted, and if an abort fires while the timer is pending it clears
 * the timer and resolves early so the awaiting loop resumes on the next
 * microtask and hits its own `signal.aborted` check — matching the
 * `cancelAnimationFrame`-on-abort behaviour of the RAF scheduler.
 */
export function yieldMacrotask(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(id);
      resolve();
    };
    const id = setTimeout(() => {
      // Normal fire: drop the abort listener so it doesn't accumulate on a
      // long-lived signal across the (many) yields of one decrypt pass (#789
      // review). `{ once: true }` only auto-removes on the abort path.
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, 0);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
