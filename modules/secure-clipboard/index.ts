// JS face of the SecureClipboard native module (#1223): copy a secret so
// the OS treats it as sensitive (Android) / local-only and expiring (iOS).
// Optional on purpose: a dev client built before this module existed (or a
// test environment) has no native side, and callers must then refuse to
// copy rather than fall back to a plain, unprotected clipboard write.
import { requireOptionalNativeModule } from 'expo-modules-core';

interface SecureClipboardNative {
  setSecretStringAsync(text: string, expireAfterMs: number): Promise<void>;
}

const SecureClipboard = requireOptionalNativeModule<SecureClipboardNative>('SecureClipboard');

export function isSecureClipboardAvailable(): boolean {
  return SecureClipboard != null;
}

/**
 * Copy `text` with the platform's secret protections. `expireAfterMs` is
 * enforced by the OS on iOS only. Throws if the native module is missing.
 */
export async function setSecretStringAsync(text: string, expireAfterMs: number): Promise<void> {
  if (!SecureClipboard) throw new Error('SecureClipboard native module is not available');
  await SecureClipboard.setSecretStringAsync(text, expireAfterMs);
}
