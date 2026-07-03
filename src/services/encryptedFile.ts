import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

/**
 * AES-256-GCM file encryption for NIP-17 kind-15 attachments (#235, #688).
 *
 * Encrypt a file's bytes on-device before uploading the **ciphertext** to a
 * Blossom server, so the server (even a public one like blossom.primal.net)
 * never sees the content. The key + nonce travel only inside the NIP-17
 * gift-wrapped message as `decryption-key` / `decryption-nonce` tags.
 *
 * Scheme (matches NIP-17 `encryption-algorithm: aes-gcm`):
 *  - 256-bit (32-byte) random key, 96-bit (12-byte) random nonce — the GCM
 *    standard nonce size.
 *  - `@noble/ciphers` appends the 16-byte GCM auth tag to the ciphertext,
 *    so `decrypt` both decrypts and verifies integrity (throws on tamper or
 *    wrong key) — no separate MAC needed.
 *  - Key + nonce are hex-encoded for the message tags (32-byte key → 64 hex
 *    chars, 12-byte nonce → 24 hex chars).
 *  - `sha256Hex` is the hash of the **ciphertext**, which is both the
 *    Blossom content address and the NIP-17 `x` integrity tag.
 */

export const KEY_BYTES = 32;
export const NONCE_BYTES = 12;
export const ENCRYPTION_ALGORITHM = 'aes-gcm' as const;

export interface EncryptedFile {
  /** Encrypted bytes (plaintext + appended 16-byte GCM tag) to upload. */
  ciphertext: Uint8Array;
  /** Hex AES-256 key — goes in the NIP-17 `decryption-key` tag. */
  keyHex: string;
  /** Hex GCM nonce — goes in the NIP-17 `decryption-nonce` tag. */
  nonceHex: string;
  /** SHA-256 of the ciphertext — Blossom address + NIP-17 `x` tag. */
  sha256Hex: string;
}

/** Encrypt file bytes with a fresh random AES-256-GCM key + nonce. */
export function encryptFile(plaintext: Uint8Array): EncryptedFile {
  const key = randomBytes(KEY_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = gcm(key, nonce).encrypt(plaintext);
  return {
    ciphertext,
    keyHex: bytesToHex(key),
    nonceHex: bytesToHex(nonce),
    sha256Hex: bytesToHex(sha256(ciphertext)),
  };
}

/**
 * Decrypt ciphertext with the hex key + nonce from a kind-15 message.
 * Throws if the key/nonce are malformed, or if GCM auth fails (tampered
 * ciphertext or wrong key) — callers should surface a "couldn't decrypt"
 * state rather than play garbage.
 */
export function decryptFile(ciphertext: Uint8Array, keyHex: string, nonceHex: string): Uint8Array {
  const key = hexToBytes(keyHex);
  const nonce = hexToBytes(nonceHex);
  if (key.length !== KEY_BYTES) {
    throw new Error(`Invalid decryption key length: ${key.length} bytes (expected ${KEY_BYTES})`);
  }
  if (nonce.length !== NONCE_BYTES) {
    throw new Error(
      `Invalid decryption nonce length: ${nonce.length} bytes (expected ${NONCE_BYTES})`,
    );
  }
  return gcm(key, nonce).decrypt(ciphertext);
}
