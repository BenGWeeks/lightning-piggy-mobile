import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

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
 * getNostrNative() additionally hard-guards on Platform.OS === 'android' so
 * that if iOS autolinking is ever enabled (or the Swift stub accidentally
 * ships) the facade still cannot route real crypto into stub functions that
 * throw — it stays null off-Android until M3 delivers real iOS bindings. This
 * mirrors the repo-local pattern in modules/background-dm-service/index.ts.
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

/**
 * Null when the native module isn't linked (iOS, Expo Go, stale dev client)
 * OR whenever the platform isn't Android. The explicit Platform guard is
 * belt-and-braces: it keeps the "Android-only" contract from being broken by a
 * future iOS autolink or an accidentally-shipped stub until real iOS bindings
 * land in M3.
 */
export function getNostrNative(): NostrNativeApi | null {
  if (Platform.OS !== 'android') return null;
  return NostrNative;
}
