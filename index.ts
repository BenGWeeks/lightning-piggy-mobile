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

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
