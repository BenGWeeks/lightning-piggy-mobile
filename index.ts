import { registerRootComponent } from 'expo';
import { LogBox } from 'react-native';

import App from './App';

// Suppress the dev tools warning banner that blocks the tab bar
LogBox.ignoreLogs(['An unknown error occurred while installing React Native DevTools']);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
