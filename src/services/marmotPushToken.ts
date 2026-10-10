// MIP-05 token encryption — THIS device's native push token, sealed to a
// notification server (Transponder) so only that server can read it.
//
//   TokenPlaintext = platform[1] || len[2] || device_token || random padding  (1024 B)
//   EncryptedToken = ephemeral_xonly[32] || nonce[12] || ChaCha20-Poly1305(pt)[1040]
//   key = HKDF-SHA256(salt "marmot-push-token-v1", IKM = ECDH x, info
//         "marmot-push-token-encryption", 32)
//
// Spec: marmot features/push-notifications.md "Token encryption"; mirrors
// Transponder's crypto/token.rs decryptor and MDK's `encrypted_push_token`.

import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export type PushPlatform = 'apns' | 'fcm';

export const ENCRYPTED_TOKEN_LEN = 1084;
const PLAINTEXT_LEN = 1024;
const MAX_TOKEN_LEN = PLAINTEXT_LEN - 3;
const NONCE_LEN = 12;
const HKDF_SALT = utf8ToBytes('marmot-push-token-v1');
const HKDF_INFO = utf8ToBytes('marmot-push-token-encryption');
export const PLATFORM_BYTE: Record<PushPlatform, number> = { apns: 1, fcm: 2 };

/** Randomness seams, for known-answer tests only. */
export interface TokenEncryptionRandomness {
  ephemeralSecret?: Uint8Array;
  nonce?: Uint8Array;
  padding?: Uint8Array;
}

/**
 * The raw platform token bytes: APNs tokens arrive as hex (expo's
 * `getDevicePushTokenAsync` on iOS) and are sent to Apple as bytes; FCM
 * tokens are opaque strings sent as their UTF-8 bytes.
 */
export function deviceTokenBytes(platform: PushPlatform, raw: string): Uint8Array {
  let bytes: Uint8Array;
  if (platform === 'apns') {
    if (!/^(?:[0-9a-fA-F]{2})+$/.test(raw)) throw new Error('push: APNs token is not hex');
    bytes = hexToBytes(raw.toLowerCase());
  } else {
    bytes = utf8ToBytes(raw);
  }
  if (bytes.length < 1 || bytes.length > MAX_TOKEN_LEN) {
    throw new Error('push: device token length out of range');
  }
  return bytes;
}

/** `sha256:` + the first 24 hex chars of SHA-256(platform_byte || token). */
export function tokenFingerprint(platform: PushPlatform, token: Uint8Array): string {
  const buf = new Uint8Array(1 + token.length);
  buf[0] = PLATFORM_BYTE[platform];
  buf.set(token, 1);
  return `sha256:${bytesToHex(sha256(buf)).slice(0, 24)}`;
}

/** HKDF-SHA256 Extract + Expand of the raw ECDH X coordinate. */
export function pushEncryptionKey(sharedX: Uint8Array): Uint8Array {
  return hkdf(sha256, sharedX, HKDF_SALT, HKDF_INFO, 32);
}

/** The server key lifted to its even-Y point (BIP-340); throws if invalid. */
function serverPoint(serverHex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(serverHex)) throw new Error('push: server key is not x-only hex');
  const compressed = hexToBytes(`02${serverHex}`);
  secp256k1.Point.fromBytes(compressed); // throws when not on the curve
  return compressed;
}

/** Seal `token` to the notification server `serverHex` (x-only, lowercase). */
export function encryptPushToken(
  platform: PushPlatform,
  token: Uint8Array,
  serverHex: string,
  rand: TokenEncryptionRandomness = {},
): Uint8Array {
  if (token.length < 1 || token.length > MAX_TOKEN_LEN) {
    throw new Error('push: device token length out of range');
  }
  const server = serverPoint(serverHex);
  const secret = rand.ephemeralSecret ?? secp256k1.utils.randomSecretKey();
  if (!secp256k1.utils.isValidSecretKey(secret)) throw new Error('push: invalid ephemeral key');
  // Compressed shared point → drop the parity byte: the raw X coordinate.
  // x(e·S) is the same whichever Y the server or ephemeral key really has,
  // which is why both sides may lift x-only keys to even Y.
  const sharedX = secp256k1.getSharedSecret(secret, server, true).slice(1);
  if (sharedX.every((b) => b === 0)) throw new Error('push: degenerate ECDH result');
  const key = pushEncryptionKey(sharedX);

  const plaintext = new Uint8Array(PLAINTEXT_LEN);
  plaintext[0] = PLATFORM_BYTE[platform];
  plaintext[1] = token.length >> 8;
  plaintext[2] = token.length & 0xff;
  plaintext.set(token, 3);
  const padLen = PLAINTEXT_LEN - 3 - token.length;
  const padding = rand.padding ?? randomBytes(padLen);
  if (padding.length !== padLen) throw new Error('push: bad padding length');
  plaintext.set(padding, 3 + token.length);

  const nonce = rand.nonce ?? randomBytes(NONCE_LEN);
  if (nonce.length !== NONCE_LEN) throw new Error('push: bad nonce length');
  const sealed = chacha20poly1305(key, nonce).encrypt(plaintext); // ct || tag

  const out = new Uint8Array(ENCRYPTED_TOKEN_LEN);
  out.set(schnorr.getPublicKey(secret), 0);
  out.set(nonce, 32);
  out.set(sealed, 32 + NONCE_LEN);
  return out;
}
