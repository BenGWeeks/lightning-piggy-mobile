/**
 * Coalesces a stream of items into batched flushes: at most one flush per
 * `flushMs` quiet window, with a LEADING edge — the first item after a quiet
 * period flushes immediately instead of waiting out the window.
 *
 * Built for the live DM sub's inbox batching (#934 item 3). Under a relay
 * re-stream burst (200+ events on a cold arm) a per-event `setState` caused
 * 30+ re-renders/sec and locked the JS thread, so entries must batch. But the
 * common foreground case is ONE new message arriving — a trailing-only timer
 * makes even that lone DM idle out the full window before it surfaces.
 * Leading-edge flush gives the lone message zero added latency while a burst
 * still coalesces to at most one flush per window.
 */
export interface CoalescedFlushQueue<T> {
  /** Enqueue one item; may flush synchronously (leading edge / threshold). */
  push: (item: T) => void;
  /** Flush anything pending now (teardown / manual). No-op when empty. */
  flush: () => void;
}

export function createCoalescedFlushQueue<T>(options: {
  /** Minimum quiet window between flushes, in ms. */
  flushMs: number;
  /** Flush immediately once this many items are pending, regardless of the window. */
  threshold: number;
  onFlush: (batch: T[]) => void;
  /** Injectable clock for tests. Defaults to Date.now. */
  now?: () => number;
}): CoalescedFlushQueue<T> {
  const { flushMs, threshold, onFlush, now = Date.now } = options;
  let pending: T[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Epoch ms of the last non-empty flush. Starts at 0 so the very first
  // item ever pushed always takes the leading edge.
  let lastFlushAt = 0;

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    lastFlushAt = now();
    onFlush(batch);
  };

  const push = (item: T): void => {
    pending.push(item);
    if (pending.length >= threshold) {
      flush();
      return;
    }
    if (timer !== null) return;
    // Clamp elapsed to >= 0: if the wall clock jumps BACKWARDS (manual change
    // / NTP correction) `now() - lastFlushAt` can go negative, which would
    // otherwise inflate the timeout below to more than a full window and
    // stall the flush. A non-negative elapsed keeps behaviour sane.
    const elapsed = Math.max(0, now() - lastFlushAt);
    if (elapsed >= flushMs) {
      // Leading edge: first item after a quiet window surfaces immediately.
      flush();
      return;
    }
    // Mid-window: trail on the REMAINDER of the window (not a fresh full
    // one) so the worst-case added latency stays bounded at flushMs. Clamp
    // the delay into [0, flushMs] as belt-and-braces against clock skew.
    const delay = Math.min(flushMs, Math.max(0, flushMs - elapsed));
    timer = setTimeout(flush, delay);
  };

  return { push, flush };
}
