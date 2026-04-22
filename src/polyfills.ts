// CRITICAL: These polyfills MUST be imported before any @getalby/sdk imports
// Order matters - getRandomValues must come first
import 'message-port-polyfill';
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';
import { Buffer } from 'buffer';

// Buffer polyfill for bitcoinjs-lib and bip32
if (typeof global.Buffer === 'undefined') {
  (global as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

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
