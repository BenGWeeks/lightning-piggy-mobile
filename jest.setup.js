// Jest global setup for Lightning Piggy Mobile.
//
// Kept intentionally small — add mocks here when a test needs to stub a native
// module that `jest-expo` doesn't already mock (e.g. expo-secure-store with
// custom data, react-native-nfc-manager, etc.). Per-test overrides should live
// in the test file itself, not here.

// React Native modules read `__DEV__` (defined globally by Metro at
// runtime). Jest doesn't define it, so `if (__DEV__) console.warn(...)`
// branches in app code throw `__DEV__ is not defined` during a test
// run unless we provide a global stub. Set true here so dev-only
// branches are exercised by tests (matches Metro's `expo start`).
if (typeof global !== 'undefined') {
  global.__DEV__ = true;
}
