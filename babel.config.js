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
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ...(isRelease
        ? [['transform-remove-console', { exclude: ['warn', 'error', 'assert'] }]]
        : []),
      'react-native-reanimated/plugin',
    ],
  };
};
