// CRITICAL: These polyfills MUST be imported before any @getalby/sdk imports
// Order matters - getRandomValues must come first
import 'message-port-polyfill';
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';

const TextEncodingPolyfill = require('text-encoding');

// Ensure crypto object exists
if (typeof global.crypto === 'undefined') {
  (global as any).crypto = {} as any;
}

// Set up TextEncoder/TextDecoder
Object.assign(global, {
  TextEncoder: TextEncodingPolyfill.TextEncoder,
  TextDecoder: TextEncodingPolyfill.TextDecoder,
});
