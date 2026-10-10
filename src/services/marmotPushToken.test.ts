import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

import {
  deviceTokenBytes,
  encryptPushToken,
  ENCRYPTED_TOKEN_LEN,
  pushEncryptionKey,
  tokenFingerprint,
} from './marmotPushToken';

/** Transponder's decryptor (crypto/token.rs), transcribed: lift the
 * ephemeral x-only key to even Y, ECDH with the server secret, HKDF, open,
 * parse platform / length / token. */
function transponderDecrypt(serverSecret: Uint8Array, blob: Uint8Array) {
  expect(blob.length).toBe(1084);
  const ephemeral = hexToBytes(`02${bytesToHex(blob.slice(0, 32))}`);
  const sharedX = secp256k1.getSharedSecret(serverSecret, ephemeral, true).slice(1);
  const key = pushEncryptionKey(sharedX);
  const plaintext = chacha20poly1305(key, blob.slice(32, 44)).decrypt(blob.slice(44));
  expect(plaintext.length).toBe(1024);
  const len = (plaintext[1] << 8) | plaintext[2];
  return { platform: plaintext[0], token: plaintext.slice(3, 3 + len) };
}

const SERVER_SECRET = new Uint8Array(32).fill(0x44);
const SERVER = bytesToHex(schnorr.getPublicKey(SERVER_SECRET));

describe('MIP-05 token encryption', () => {
  it("matches Transponder's fixed HKDF conformance vector", () => {
    const sharedX = Uint8Array.from({ length: 32 }, (_, i) => i);
    expect(bytesToHex(pushEncryptionKey(sharedX))).toBe(
      '954b9d7be996c0e74517fe49e41e1278f44395d2855a52f50b5e322976dd168d',
    );
  });

  // Known answers from an independent implementation (pyca/cryptography:
  // secp256k1 ECDH → HKDF-SHA256 → ChaCha20-Poly1305) with fixed randomness.
  it.each([
    {
      platform: 'fcm' as const,
      token: utf8ToBytes('test-fcm-device-token-12345'),
      eph: 0x11,
      nonce: 0x22,
      digest: '7a14852f0c68c1841d868b43964b164529761a5ebe688ebfb3630a3086139883',
      head: '4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa222222222222222222222222c0588c5baaf75fda54566dfb0c9f23a8147b4541',
      tail: '560853ccd24710fe788de16dfb4fb54b',
      fingerprint: 'sha256:52874581455b1161e63f5458',
    },
    {
      platform: 'apns' as const,
      token: hexToBytes('deadbeef1234567890abcdefdeadbeef1234567890abcdefdeadbeef12345678'),
      eph: 0x55,
      nonce: 0x66,
      digest: '1e93099659f9afa8f014f18b10590575c3df7ccd66c013bfd3b2cc629a2e8b88',
      head: '9ac20335eb38768d2052be1dbbc3c8f6178407458e51e6b4ad22f1d91758895b6666666666666666666666663d89dd0b27ae126669743d4c4cab06b87ab086cc',
      tail: '9629e283784f0158b72fe363ff398d3e',
      fingerprint: 'sha256:be8017c127ac46dd980e1898',
    },
  ])('reproduces the $platform known-answer vector byte for byte', (v) => {
    expect(SERVER).toBe('2c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991');
    const blob = encryptPushToken(v.platform, v.token, SERVER, {
      ephemeralSecret: new Uint8Array(32).fill(v.eph),
      nonce: new Uint8Array(12).fill(v.nonce),
      padding: new Uint8Array(1021 - v.token.length).fill(0x33),
    });
    expect(blob.length).toBe(ENCRYPTED_TOKEN_LEN);
    expect(bytesToHex(sha256(blob))).toBe(v.digest);
    expect(bytesToHex(blob.slice(0, 64))).toBe(v.head);
    expect(bytesToHex(blob.slice(-16))).toBe(v.tail);
    expect(tokenFingerprint(v.platform, v.token)).toBe(v.fingerprint);
  });

  it('round-trips through the server-side decryption with real randomness', () => {
    const token = utf8ToBytes('fcm:' + 'x'.repeat(150));
    const a = encryptPushToken('fcm', token, SERVER);
    const b = encryptPushToken('fcm', token, SERVER);
    // Fresh ephemeral key + nonce each time: two seals never match.
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
    for (const blob of [a, b]) {
      const opened = transponderDecrypt(SERVER_SECRET, blob);
      expect(opened.platform).toBe(2);
      expect(bytesToHex(opened.token)).toBe(bytesToHex(token));
    }
  });

  it('rejects a server key that is not a curve point, and bad token sizes', () => {
    expect(() => encryptPushToken('fcm', utf8ToBytes('t'), 'ff'.repeat(32))).toThrow();
    expect(() => encryptPushToken('fcm', utf8ToBytes('t'), 'not-hex')).toThrow();
    expect(() => encryptPushToken('fcm', new Uint8Array(0), SERVER)).toThrow();
    expect(() => encryptPushToken('fcm', new Uint8Array(1022), SERVER)).toThrow();
    expect(encryptPushToken('fcm', new Uint8Array(1021).fill(1), SERVER).length).toBe(1084);
  });
});

describe('deviceTokenBytes', () => {
  it('decodes APNs hex and keeps FCM tokens as UTF-8', () => {
    expect(bytesToHex(deviceTokenBytes('apns', 'DEADbeef'))).toBe('deadbeef');
    expect(deviceTokenBytes('fcm', 'abc:DEF')).toEqual(utf8ToBytes('abc:DEF'));
    expect(() => deviceTokenBytes('apns', 'abc')).toThrow();
    expect(() => deviceTokenBytes('apns', 'zz')).toThrow();
    expect(() => deviceTokenBytes('fcm', '')).toThrow();
  });
});
