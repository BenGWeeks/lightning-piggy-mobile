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
