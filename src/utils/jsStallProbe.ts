// Measures how long the JS thread was blocked while some async work ran.
//
// A repeating timer should fire every `intervalMs`; when it fires late, the
// delay is time the thread spent busy elsewhere (relay parsing, signature
// checks, React commits) — time in which a tap could not be dispatched. Used
// by `[PerfBlock]` markers to prove a perf fix on device, so callers gate it
// behind the perf-log flag and it never runs in production.

export interface JsStallReport {
  /** Longest single stall seen (ms beyond the expected interval). */
  maxMs: number;
  /** Sum of all stalls longer than one frame-ish budget (ms). */
  blockedMs: number;
}

export interface JsStallProbe {
  stop: () => JsStallReport;
}

/** Ignore jitter below this — only stalls a user could feel count. */
const STALL_THRESHOLD_MS = 50;

export function startJsStallProbe(intervalMs = 50): JsStallProbe {
  let last = Date.now();
  let maxMs = 0;
  let blockedMs = 0;
  const sample = () => {
    const now = Date.now();
    const lag = Math.max(0, now - last - intervalMs);
    if (lag > maxMs) maxMs = lag;
    if (lag >= STALL_THRESHOLD_MS) blockedMs += lag;
    last = now;
  };
  const id = setInterval(sample, intervalMs);
  let stopped: JsStallReport | null = null;
  return {
    stop: () => {
      if (stopped) return stopped;
      clearInterval(id);
      sample();
      stopped = { maxMs, blockedMs };
      return stopped;
    },
  };
}
