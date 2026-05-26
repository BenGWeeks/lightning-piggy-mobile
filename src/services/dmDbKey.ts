import * as SecureStore from 'expo-secure-store';
import { bytesToHex } from '@noble/hashes/utils.js';

// 256-bit symmetric key that encrypts the local DM database at rest
// (SQLCipher, #695 / #690). It lives in expo-secure-store — the OS
// keystore (Android Keystore / iOS Keychain), hardware-backed — so the
// DB file on disk is ciphertext and this key only ever sits in RAM at
// runtime. This is the only piece small enough to belong in the keystore;
// the bulk message data lives in the (encrypted) DB file, not here.
const DM_DB_KEY_STORE_KEY = 'dm_db_key_v1';
const DM_DB_KEY_BYTES = 32;

// Single-flight cache so concurrent callers on cold start share one
// generation — otherwise two racing first-run calls could each mint and
// persist a different key (last write wins), and the DB would then fail to
// open with the other. Reset by clearDmDbKey on logout.
let keyPromise: Promise<string> | null = null;

async function resolveKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DM_DB_KEY_STORE_KEY);
  if (existing) return existing;
  const bytes = new Uint8Array(DM_DB_KEY_BYTES);
  crypto.getRandomValues(bytes);
  const key = bytesToHex(bytes);
  await SecureStore.setItemAsync(DM_DB_KEY_STORE_KEY, key);
  return key;
}

/**
 * The DB encryption key as 64-char hex, generating + persisting a fresh
 * random one on first call. Idempotent — later calls return the same key
 * so the encrypted DB opens consistently across launches.
 */
export function getOrCreateDmDbKey(): Promise<string> {
  if (!keyPromise) keyPromise = resolveKey();
  return keyPromise;
}

/**
 * Delete the DB key on logout / account wipe. The encrypted DB file is
 * unreadable without it and must be deleted alongside this (#690) — a
 * lone key or a lone ciphertext file is useless, but don't leave either
 * lying around.
 */
export async function clearDmDbKey(): Promise<void> {
  keyPromise = null;
  await SecureStore.deleteItemAsync(DM_DB_KEY_STORE_KEY);
}
