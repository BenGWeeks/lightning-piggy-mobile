import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * JS entry for the NostrNative local Expo module (Stage 2 M1 of #1036).
 *
 * Android-only for now: expo-module.config.json lists just "android", so
 * iOS autolinking skips the module entirely and `requireOptionalNativeModule`
 * returns null there — callers (the nostrCrypto facade) fall back to the
 * pure-JS implementation. The ios/ directory already carries the podspec +
 * Swift stub; enabling iOS in a later milestone is a one-line platforms
 * change plus a Mac-verified EAS build.
 *
 * All crypto functions are synchronous (JSI) to match the deliberately
 * synchronous JS call sites (see unwrapWrapNsec). `warmUp` is async and
 * pays the one-time JNA + libnostr_sdk_ffi.so load off the JS thread.
 */
export interface NostrNativeApi {
  warmUp(): Promise<boolean>;
  nip44Encrypt(secretKeyHex: string, counterpartyPubkeyHex: string, plaintext: string): string;
  nip44Decrypt(secretKeyHex: string, counterpartyPubkeyHex: string, payload: string): string;
  schnorrSign(messageHashHex: string, secretKeyHex: string): string;
  schnorrVerify(signatureHex: string, messageHashHex: string, publicKeyHex: string): boolean;
}

const NostrNative = requireOptionalNativeModule<NostrNativeApi>('NostrNative');

/** Null when the native module isn't linked (iOS, Expo Go, stale dev client). */
export function getNostrNative(): NostrNativeApi | null {
  return NostrNative;
}
