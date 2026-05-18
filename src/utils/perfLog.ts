// Single source of truth for cold-start perf checkpoints. Captures
// T0 at module-evaluation time (closest proxy to "JS bundle started
// executing"). Every `perfLog(tag)` call emits a single line that
// `scripts/perf-*.sh` and ad-hoc logcat greps can pull out:
//
//   [Perf] HomeScreen first render +1843ms
//   [Perf] btn-send tap +9120ms
//   [Perf] SendSheet first render +9381ms
//
// __DEV__ gated by default — production bundles strip console.log via
// the Babel transform-remove-console plugin, so this whole file is
// dead weight in release builds.
//
// Escape hatch: when `EXPO_PUBLIC_KEEP_PERF_LOGS=1` is set at build
// time, `babel.config.js` skips the strip AND this module's guard
// passes through. Used for one-off perf-instrumented APKs sideloaded
// to a real device to attribute cold-start latency. Expo inlines
// `process.env.EXPO_PUBLIC_*` at bundle time, so the literal-string
// comparison dead-code-eliminates the rest of this file in normal
// release builds where the flag is unset.
const PERF_LOGS_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_KEEP_PERF_LOGS === '1';
let T0: number | null = null;

export function perfT0(): number {
  if (T0 === null) T0 = Date.now();
  return T0;
}

export function perfLog(tag: string): void {
  if (!PERF_LOGS_ENABLED) return;
  const t = perfT0();
  console.log(`[Perf] ${tag} +${Date.now() - t}ms`);
}

// Mark T0 explicitly. Call this from index.ts so T0 is anchored at
// the FIRST module-eval moment, not whenever this file happens to
// be imported.
export function perfAnchor(): void {
  if (T0 === null) T0 = Date.now();
}

// Tab-navigation tap-to-paint timing. Records the wall-clock at the
// tabPress event and emits the delta when the destination screen's
// focus event lands. The focus event is the closest proxy to "first
// paint of the new tab content" available without a custom native
// module — react-navigation fires it after the screen mounts and the
// transition completes. Anything > 200 ms here is what the user
// perceives as a sluggish tab; > 1 s is a noticeable freeze; > 5 s is
// the kind of lockup that prompts "did I tap?" double-presses.
const __tabTapAt = new Map<string, number>();
export function perfTabTap(tabName: string): void {
  if (!PERF_LOGS_ENABLED) return;
  // Re-arm the ready latch + clear any stale anchors so the next
  // tap→ready delta starts from this fresh tap, not a leftover one.
  __pageReadyEmitted.delete(tabName);
  __tabTapAt.set(tabName, Date.now());
  console.log(`[PerfTab] ${tabName} tap`);
}
export function perfTabRendered(tabName: string): void {
  if (!PERF_LOGS_ENABLED) return;
  const tapAt = __tabTapAt.get(tabName);
  if (tapAt === undefined) return;
  console.log(`[PerfTab] ${tabName} focus tap→focus=${Date.now() - tapAt}ms`);
  // Don't delete the tapAt yet — perfPageReady wants to compute its
  // own tap→ready delta from the same anchor. We delete in perfTabTap
  // on the next tap, which is the natural rotation point.
}

// Outgoing-tab blur marker. Fires when the *previous* tab finishes
// hiding (its blur event landed). Pairs with `perfTabTap` to bracket
// the navigation transition itself, separately from the destination
// screen's render. Anything > 100 ms between tap and hidden means the
// transition animation is itself janking, distinct from the new
// screen's render cost. Stored anchor uses the *destination* tab name
// so logs read in the order they happened on screen.
const __tabHiddenAt = new Map<string, number>();
export function perfTabHidden(outgoingTabName: string): void {
  if (!PERF_LOGS_ENABLED) return;
  // Walk every recorded tap — there's at most one in flight at a time —
  // and emit the delta. We don't know which destination triggered this
  // blur from here, so we log against the source.
  for (const [destination, tapAt] of __tabTapAt) {
    __tabHiddenAt.set(destination, Date.now());
    console.log(`[PerfTab] ${outgoingTabName} hidden tap→hidden=${Date.now() - tapAt}ms`);
  }
}

// "Page ready" marker — emitted by a destination screen when its
// content is genuinely usable (rails populated, primary fetch
// resolved). Distinct from `focus` (which fires the moment React
// Navigation mounts the screen, often before any data has loaded)
// and from `first render` (which can fire on a skeleton). The screen
// owns the definition of "ready" — typically the first non-empty
// merchant rail batch or the first 'visible' Maestro selector.
//
// Deduplicated per tab-name so it only logs the first ready event
// per visit; subsequent re-renders don't pollute the log. Reset on
// the next tab tap (we trust callers to call perfTabTap for each
// honest user-initiated focus).
const __pageReadyEmitted = new Set<string>();
export function perfPageReady(tabName: string, detail?: string): void {
  if (!PERF_LOGS_ENABLED) return;
  if (__pageReadyEmitted.has(tabName)) return;
  __pageReadyEmitted.add(tabName);
  const tapAt = __tabTapAt.get(tabName);
  const tapDelta = tapAt !== undefined ? `tap→ready=${Date.now() - tapAt}ms` : 'tap→ready=?ms';
  console.log(`[PerfTab] ${tabName} ready ${tapDelta}${detail ? ` (${detail})` : ''}`);
}

// Internal — perfTabTap clears the per-tab ready latch so the next
// honest tap re-arms it. Exported indirectly via perfTabTap's own
// behaviour; tests can call this to reset state between scenarios.
export function __perfResetTabReady(tabName: string): void {
  __pageReadyEmitted.delete(tabName);
  __tabTapAt.delete(tabName);
  __tabHiddenAt.delete(tabName);
}

// JS-thread heartbeat. A self-recurring `setTimeout(cb, 100)` that
// logs `[Perf] heartbeat #N gap=Xms` every tick. If the JS thread is
// blocked, the next tick fires LATE — `gap` reports the actual delay
// between scheduled-fire and actual-fire. Any gap > ~150 ms is a
// stutter; > 1 s is a freeze. Captures cold-start freezes (e.g.
// resolveZapSenders) that single-tap perf tests miss because the
// freeze window depends on when the user/test taps.
//
// Idempotent — calling twice is a no-op so multiple entry points
// (index.ts + dev-only tooling) can both arm it without double-firing.
let __heartbeatStarted = false;
let __heartbeatCount = 0;
let __heartbeatExpectedAt = 0;
export function perfHeartbeatStart(intervalMs = 100): void {
  if (!PERF_LOGS_ENABLED) return;
  if (__heartbeatStarted) return;
  __heartbeatStarted = true;
  __heartbeatExpectedAt = Date.now() + intervalMs;
  const tick = (): void => {
    const now = Date.now();
    const gap = now - __heartbeatExpectedAt;
    __heartbeatCount += 1;
    // Only log significant gaps + every 50th heartbeat (so the
    // logcat doesn't drown). 50 × 100 ms = 5 s of "alive" markers
    // when the thread is healthy.
    if (gap > 50 || __heartbeatCount % 50 === 0) {
      perfLog(`heartbeat #${__heartbeatCount} gap=${gap}ms`);
    }
    __heartbeatExpectedAt = now + intervalMs;
    setTimeout(tick, intervalMs);
  };
  setTimeout(tick, intervalMs);
}
