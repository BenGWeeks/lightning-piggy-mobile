import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

/**
 * JS entry for the NostrNative local Expo module (Stage 2 of #1036).
 *
 * Android (Kotlin over nostr-sdk-kmp-android, Stage 2 M1/M2) and iOS (Swift
 * over nostr-sdk-swift, Stage 2 M3) share one rust-nostr 0.44 core and one
 * contract. Everywhere else (web, Expo Go, stale dev clients) the module is
 * unlinked, `requireOptionalNativeModule` returns null, and callers (the
 * nostrCrypto facade) fall back to the pure-JS implementation.
 *
 * getNostrNative() additionally hard-guards on the native platforms so an
 * unexpected autolink on an unsupported platform can never route real crypto
 * into it. This mirrors the repo-local pattern in
 * modules/background-dm-service/index.ts.
 *
 * All crypto functions are synchronous (JSI) to match the deliberately
 * synchronous JS call sites (see unwrapWrapNsec). `warmUp` is async; on
 * Android it pays the one-time JNA + libnostr_sdk_ffi.so load off the JS
 * thread (iOS links statically — there it is just the routing latch).
 */
export interface NostrNativeApi {
  warmUp(): Promise<boolean>;
  nip44Encrypt(secretKeyHex: string, counterpartyPubkeyHex: string, plaintext: string): string;
  nip44Decrypt(secretKeyHex: string, counterpartyPubkeyHex: string, payload: string): string;
  schnorrSign(messageHashHex: string, secretKeyHex: string): string;
  schnorrVerify(signatureHex: string, messageHashHex: string, publicKeyHex: string): boolean;
}

/** Payload of the `onEngineRumorBatch` event: a JSON array (serialised once
 * on the native side — one string across the bridge instead of N nested
 * maps) of `{ rumor, sender, wrapId, wrapCreatedAt }` entries. */
export interface EngineRumorBatchEvent {
  rumorsJson: string;
}

/** Reconnect carries no payload — typed separately below so a handler can't
 * accidentally read `rumorsJson` off it. */
export type EngineReconnectEvent = Record<string, never>;

/**
 * Relay-engine surface (Stage 2 M2 of #1036) — present only in dev clients /
 * builds compiled from this milestone onward, hence the separate
 * `getNostrEngine()` feature-detection below (an M1-era binary has the
 * crypto functions but NOT these).
 */
export interface NostrEngineApi {
  /** Build + connect the rust-nostr relay pool for this viewer (nsec only —
   * the native NIP-59 unwrap needs the secret key in-process). */
  engineStart(relays: string[], viewerPubkeyHex: string, privkeyHex: string): Promise<boolean>;
  /** Open the kind-1059 wrap subscription. `filterJson` is a standard NIP-01
   * filter (no `since` — #469); `knownWrapIds` seeds the native dedupe set. */
  engineSubscribeWraps(filterJson: string, knownWrapIds: string[]): Promise<string>;
  /** Tear down the pool and clear the native single-entry key cache. */
  engineStop(): Promise<void>;
  addListener(
    eventName: 'onEngineRumorBatch',
    listener: (event: EngineRumorBatchEvent) => void,
  ): { remove(): void };
  addListener(
    eventName: 'onEngineReconnect',
    listener: (event: EngineReconnectEvent) => void,
  ): { remove(): void };
}

const NostrNative = requireOptionalNativeModule<NostrNativeApi & Partial<NostrEngineApi>>(
  'NostrNative',
);

/**
 * Null when the native module isn't linked (Expo Go, web, stale dev client)
 * OR whenever the platform isn't one with a real implementation (Android
 * Kotlin / iOS Swift). The explicit allowlist is belt-and-braces against an
 * unexpected autolink on a platform we haven't verified.
 */
export function getNostrNative(): NostrNativeApi | null {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;
  return NostrNative;
}

/**
 * Null when the module is unlinked, on an unsupported platform, OR predates
 * the M2 engine functions (a stale dev client with only the M1 crypto surface
 * — on iOS also a pre-M3 binary with no module at all — must fall back to the
 * JS relay path rather than crash on a missing native function). Built on
 * getNostrNative() so it inherits the same platform hard-guard.
 */
export function getNostrEngine(): NostrEngineApi | null {
  const native = getNostrNative() as (NostrNativeApi & Partial<NostrEngineApi>) | null;
  if (!native || typeof native.engineStart !== 'function') return null;
  return native as NostrNativeApi & NostrEngineApi;
}
