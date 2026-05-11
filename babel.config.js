module.exports = function (api) {
  api.cache(true);
  // Strip every-call-count `console.log` / `console.info` / `console.debug`
  // / `console.trace` in release bundles (any build where NODE_ENV is
  // not 'development' — that's EAS production AND EAS preview AND any
  // local `expo export` / release build, NOT just EAS production cloud
  // builds). `console.warn` and `console.error` stay so genuine
  // diagnostics still surface, and `console.assert` stays because it
  // carries semantic intent (test invariants) that production code
  // can still benefit from.
  //
  // Per issue #499 — the codebase has many diagnostic console.log
  // calls in cold-start hot paths that shouldn't be paying their cost
  // on the user's device.
  //
  // IMPORTANT ordering: react-native-reanimated/plugin MUST be the
  // last entry in the plugins array (per Reanimated's docs).
  // `transform-remove-console` is inserted BEFORE it so the stripped
  // AST is what Reanimated sees when it processes worklets.
  const isRelease = process.env.NODE_ENV !== 'development';
  // Escape hatch for a one-off perf-instrumented release build: when
  // `EXPO_PUBLIC_KEEP_PERF_LOGS=1` is set at build time (e.g. for a
  // sideloaded APK measuring cold-start latency on a real device),
  // skip the strip so `[Perf]` logcat lines survive. The runtime
  // `perfLog` helper reads the same env so it stops short-circuiting.
  // Default unset → strip as usual; never ship release builds with
  // this env set.
  const keepPerfLogs = process.env.EXPO_PUBLIC_KEEP_PERF_LOGS === '1';
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ...(isRelease && !keepPerfLogs
        ? [['transform-remove-console', { exclude: ['warn', 'error', 'assert'] }]]
        : []),
      'react-native-reanimated/plugin',
    ],
  };
};
