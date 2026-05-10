module.exports = function (api) {
  api.cache(true);
  // Strip `console.log` and `console.info` calls in production EAS
  // builds. `console.warn` and `console.error` stay so production
  // diagnostics still surface. Per issue #499 — the codebase has many
  // diagnostic console.log calls in cold-start hot paths that
  // shouldn't be paying their cost on the user's device.
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'react-native-reanimated/plugin',
      ...(isProduction ? [['transform-remove-console', { exclude: ['warn', 'error'] }]] : []),
    ],
  };
};
