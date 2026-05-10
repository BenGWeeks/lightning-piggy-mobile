import { registerRootComponent } from 'expo';
import { LogBox } from 'react-native';

import App from './App';

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
registerRootComponent(App);
