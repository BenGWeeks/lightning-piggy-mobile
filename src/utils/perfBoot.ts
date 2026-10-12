// Dependency-free first import of index.ts: capture before the app import graph runs.
export const bootT0 = __DEV__ || process.env.EXPO_PUBLIC_KEEP_PERF_LOGS === '1' ? Date.now() : 0;
if (__DEV__ || process.env.EXPO_PUBLIC_KEEP_PERF_LOGS === '1') {
  console.log('[Perf] boot T0 +0ms since boot');
}
