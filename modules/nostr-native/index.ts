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

/** Null when the native module isn't linked (iOS, Expo Go, stale dev client). */
export function getNostrNative(): NostrNativeApi | null {
  return NostrNative;
}

/**
 * Null when the module is unlinked OR predates the M2 engine functions (a
 * stale dev client with only the M1 crypto surface must fall back to the JS
 * relay path rather than crash on a missing native function).
 */
export function getNostrEngine(): NostrEngineApi | null {
  if (!NostrNative || typeof NostrNative.engineStart !== 'function') return null;
  return NostrNative as NostrNativeApi & NostrEngineApi;
}
