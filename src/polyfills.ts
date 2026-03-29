// CRITICAL: These polyfills MUST be imported before any @getalby/sdk imports
// Order matters - getRandomValues must come first
import 'message-port-polyfill';
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TextEncodingPolyfill = require('text-encoding');

// Ensure crypto object exists
if (typeof global.crypto === 'undefined') {
  (global as unknown as { crypto: object }).crypto = {};
}

// Set up TextEncoder/TextDecoder
Object.assign(global, {
  TextEncoder: TextEncodingPolyfill.TextEncoder,
  TextDecoder: TextEncodingPolyfill.TextDecoder,
});
