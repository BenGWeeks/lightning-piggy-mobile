// Jest global setup for Lightning Piggy Mobile.
//
// Kept intentionally small — add mocks here when a test needs to stub a native
// module that `jest-expo` doesn't already mock (e.g. expo-secure-store with
// custom data, react-native-nfc-manager, etc.). Per-test overrides should live
// in the test file itself, not here.

// Silence noisy warnings from RN's `LogBox` in jsdom environment.
if (typeof global !== 'undefined') {
  global.__DEV__ = true;
}
