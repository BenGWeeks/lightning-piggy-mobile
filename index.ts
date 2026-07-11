import { registerRootComponent } from 'expo';
import { LogBox } from 'react-native';
import { perfAnchor, perfLog, perfHeartbeatStart } from './src/utils/perfLog';
// Side-effect import: defines the background-sync task in the global scope
// so expo-background-task can invoke it after an OS-driven relaunch (#279).
import './src/services/backgroundTask';
// Side-effect import: registers the BackgroundDmTask headless JS task in the
// global scope so the native Android foreground service (and the BootReceiver
// after a reboot) can run it even when no React tree is mounted (#279).
import './src/services/backgroundDmHeadlessTask';

// Anchor T0 at the FIRST line of JS execution (this module is the
// app's entry point per registerRootComponent below). Every later
// `perfLog(tag)` call reports `+Nms` relative to here, so a single
// `adb logcat | grep "[Perf]"` gives the entire cold-start timeline.
perfAnchor();
perfLog('index.ts module-eval');
// Start the JS-thread heartbeat so cold-start freezes show up as
// large `gap=Xms` values in the perf log, even when no user taps.
perfHeartbeatStart();

import App from './App';
perfLog('App.tsx imported');

// Suppress the dev-tools / debugger warning banners. The "Open debugger
// to view warnings" overlay keeps intercepting taps + stealing focus on
// every fast-refresh, and the chrome-sandbox launch error is cosmetic on
// Linux (documented in TROUBLESHOOTING.adoc). Silence the LogBox entirely
// in __DEV__ for development ergonomics.
if (__DEV__) {
  LogBox.ignoreAllLogs(true);
}

// Dedupe @getalby/sdk's "NIP-04 encryption is about to be deprecated"
// warning. The SDK fires it once per nip04.encrypt / nip04.decrypt, so
// every kind-4 in the inbox-drain trips it. Each console.warn from JS is
// a native bridge round-trip in dev + serializer cost in release; on a
// busy inbox this stacks up to >100ms of bridge traffic during cold
// start, which adds to the "Send sheet feels frozen just after launch"
// symptom. Keep one log per session for visibility.
const NIP04_DEPRECATION_PREFIX = 'NIP-04 encryption is about to be deprecated';
const __originalConsoleWarn = console.warn.bind(console);
let __nip04WarnCount = 0;
console.warn = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === 'string' && first.startsWith(NIP04_DEPRECATION_PREFIX)) {
    __nip04WarnCount += 1;
    if (__nip04WarnCount === 1) {
      __originalConsoleWarn(`${first} (further instances suppressed)`);
    }
    return;
  }
  __originalConsoleWarn(...args);
};

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
perfLog('registerRootComponent called');
registerRootComponent(App);

// Dev-only crypto benchmark for the #1046 native module bring-up. The
// EXPO_PUBLIC_* literal is inlined at bundle time, so in every normal build
// this whole block is dead code; the __DEV__ guard additionally makes it
// impossible to ship the bench in a release/preview build even if the env
// var leaks into one. The lazy import keeps the bench (and its
// @noble/nostr-tools vector setup) off the cold-start path, and the delay
// lets startup settle so timings aren't polluted by launch work.
if (__DEV__ && process.env.EXPO_PUBLIC_NATIVE_CRYPTO_BENCH === '1') {
  setTimeout(() => {
    import('./src/utils/nostrCryptoBench')
      .then((bench) => bench.runNostrCryptoBench())
      .catch((error) => console.log('[PerfBlock] cryptoBench failed to run:', error));
  }, 8000);
}

// Dev-only relay-engine benchmark (#1049): drains a synthetic 200-wrap
// backlog from the local bench relay (scripts/bench-engine-relay.mjs)
// through the JS unwrap path and the native engine. Same bundle-time
// inlining + __DEV__ + lazy-import guards as the crypto bench above.
if (__DEV__ && process.env.EXPO_PUBLIC_NATIVE_ENGINE_BENCH === '1') {
  setTimeout(() => {
    import('./src/utils/nativeEngineBench')
      .then((bench) => bench.runNativeEngineBench())
      .catch((error) => console.log('[PerfBlock] engineBench failed to run:', error));
  }, 8000);
}
