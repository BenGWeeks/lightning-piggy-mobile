/**
 * Crypto facade — single seam for all local NIP-44 / schnorr operations.
 *
 * Why this file exists
 * --------------------
 * Stage 1a of epic #1036 (native-crypto): extract every call site that
 * performs local crypto (nip44 encrypt/decrypt, schnorr sign/verify via
 * finalizeEvent/verifyEvent, event hashing) behind a single module so that
 * Stage 1b can swap the implementation to rust-nostr FFI without touching
 * the rest of the codebase — one file to change, zero business logic to
 * re-verify.
 *
 * What lives here
 * ---------------
 * Only LOCAL crypto operations. The Amber (NIP-55 IPC) and NIP-46 (bunker
 * relay-RPC) paths are NOT crypto we run locally — they delegate to an
 * external signer and stay in their own service files untouched.
 *
 * Benchmark harness
 * -----------------
 * When EXPO_PUBLIC_KEEP_PERF_LOGS=1, each wrapped operation records a
 * timing sample. A periodic summary (at most once per 60 s) logs:
 *
 *   [PerfBlock] nostrCrypto nip44Decrypt n=42 p50=1ms p95=3ms
 *
 * Overhead on the hot path: one performance.now() pair + one array push per
 * call. No logging on the hot path itself.
 */

import { bytesToHex } from '@noble/hashes/utils.js';
import * as nip44 from 'nostr-tools/nip44';
import {
  finalizeEvent,
  getEventHash,
  verifiedSymbol,
  verifyEvent,
  type Event as NostrEvent,
  type VerifiedEvent,
  type UnsignedEvent,
} from 'nostr-tools/pure';

import { getNostrNative, type NostrNativeApi } from '../../modules/nostr-native';

// ---------------------------------------------------------------------------
// Perf gate — matches perfLog.ts pattern exactly (gated on build-time env,
// not __DEV__ alone so it fires in EXPO_PUBLIC_KEEP_PERF_LOGS preview APKs).
// ---------------------------------------------------------------------------
const PERF_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_KEEP_PERF_LOGS === '1';

// ---------------------------------------------------------------------------
// Native routing (Stage 2 M1, #1046) — rust-nostr via modules/nostr-native.
//
// EXPO_PUBLIC_NATIVE_CRYPTO=1 routes the sk+pk-shaped operations below to
// the native module when it is linked (Android dev/EAS builds); everything
// else — and every platform where the module is absent — keeps the exact JS
// path. EXPO_PUBLIC_NATIVE_CRYPTO_XCHECK=1 additionally runs BOTH
// implementations per op in dev and logs any divergence loudly.
//
// Both env literals are inlined at bundle time, so a normal build (flags
// unset) keeps today's JS behaviour with zero routing overhead beyond one
// boolean check. The conversation-key-shaped nip44Decrypt/nip44Encrypt
// cannot route natively (rust-nostr's FFI derives the conversation key
// internally from sk+pk and does not accept a raw key), which is why the
// sk+pk wrappers below exist and call sites prefer them.
// ---------------------------------------------------------------------------

const flags = {
  native: process.env.EXPO_PUBLIC_NATIVE_CRYPTO === '1',
  xcheck: __DEV__ && process.env.EXPO_PUBLIC_NATIVE_CRYPTO_XCHECK === '1',
};

/** @internal Test use only — flip routing/cross-check without rebuilding env. */
export function __setNostrCryptoFlagsForTests(next: { native?: boolean; xcheck?: boolean }): void {
  if (!__DEV__) return;
  if (next.native !== undefined) flags.native = next.native;
  if (next.xcheck !== undefined) flags.xcheck = next.xcheck;
}

function nativeIfActive(): NostrNativeApi | null {
  return flags.native ? getNostrNative() : null;
}

/** True when sk+pk-shaped ops are actually routing to the native module. */
export function isNativeCryptoActive(): boolean {
  return nativeIfActive() !== null;
}

/**
 * Pays the native module's one-time JNA + .so load off the JS thread.
 * Resolves false (never rejects) when native crypto isn't linked or can't
 * load — callers just stay on the JS path.
 */
export async function warmUpNativeCrypto(): Promise<boolean> {
  const native = nativeIfActive();
  if (!native) return false;
  try {
    return await native.warmUp();
  } catch {
    return false;
  }
}

// Never log key material or plaintext — lengths/verdicts are enough to find
// a divergence without leaking a DM into logcat.
function reportMismatch(op: string, detail: string): void {
  console.error(
    `[NostrCrypto] XCHECK MISMATCH op=${op} ${detail} — native and JS implementations disagree`,
  );
}

// (a circular buffer via splice-and-push is equivalent and simpler).
// Sliding window — keeps the most recent MAX_SAMPLES timing samples per op
// (oldest sample evicted via shift when the window is full).
// ---------------------------------------------------------------------------
const MAX_SAMPLES = 200;

interface OpStats {
  samples: number[];
  count: number;
}

const stats: Record<string, OpStats> = {
  nip44Decrypt: { samples: [], count: 0 },
  nip44Encrypt: { samples: [], count: 0 },
  schnorrSign: { samples: [], count: 0 },
  schnorrVerify: { samples: [], count: 0 },
  eventHash: { samples: [], count: 0 },
};

/** Append one timing sample, evicting oldest when window is full. */
function recordSample(op: string, ms: number): void {
  const s = stats[op];
  if (!s) return;
  s.count += 1;
  if (s.samples.length >= MAX_SAMPLES) s.samples.shift();
  s.samples.push(ms);
}

/** Compute p50 and p95 from an unsorted sample array (sorts a copy). */
function percentiles(arr: number[]): { p50: number; p95: number } {
  if (arr.length === 0) return { p50: 0, p95: 0 };
  const sorted = arr.slice().sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1] ?? 0;
  return { p50, p95 };
}

// ---------------------------------------------------------------------------
// Summary logger — fires at most once per 60 s, only when ops occurred.
// ---------------------------------------------------------------------------
const SUMMARY_INTERVAL_MS = 60_000;
let lastSummaryAt = 0;
let summaryScheduled = false;

function scheduleSummary(): void {
  if (!PERF_ENABLED || summaryScheduled) return;
  summaryScheduled = true;
  const delay = Math.max(0, SUMMARY_INTERVAL_MS - (Date.now() - lastSummaryAt));
  setTimeout(() => {
    summaryScheduled = false;
    const now = Date.now();
    if (now - lastSummaryAt < SUMMARY_INTERVAL_MS) return;
    lastSummaryAt = now;
    for (const [op, s] of Object.entries(stats)) {
      if (s.count === 0) continue;
      const { p50, p95 } = percentiles(s.samples);
      console.log(`[PerfBlock] nostrCrypto ${op} n=${s.count} p50=${p50}ms p95=${p95}ms`);
    }
  }, delay);
}

// ---------------------------------------------------------------------------
// Instrumented wrappers
// ---------------------------------------------------------------------------

/**
 * NIP-44 v2: derive shared conversation key from a secret key and a peer's
 * public key. Called once per decrypt/encrypt pair; result may be cached by
 * callers when processing multiple layers (as nip17Unwrap does).
 */
export function nip44GetConversationKey(secretKey: Uint8Array, peerPublicKey: string): Uint8Array {
  return nip44.v2.utils.getConversationKey(secretKey, peerPublicKey);
}

/**
 * NIP-44 v2 decrypt. Throws on invalid ciphertext (caller must try/catch).
 * Benchmarked as the dominant hot-path cost during inbox ingest.
 */
export function nip44Decrypt(ciphertext: string, conversationKey: Uint8Array): string {
  if (!PERF_ENABLED) {
    return nip44.v2.decrypt(ciphertext, conversationKey);
  }
  const t0 = performance.now();
  const result = nip44.v2.decrypt(ciphertext, conversationKey);
  recordSample('nip44Decrypt', performance.now() - t0);
  scheduleSummary();
  return result;
}

/**
 * NIP-44 v2 encrypt.
 */
export function nip44Encrypt(plaintext: string, conversationKey: Uint8Array): string {
  if (!PERF_ENABLED) {
    return nip44.v2.encrypt(plaintext, conversationKey);
  }
  const t0 = performance.now();
  const result = nip44.v2.encrypt(plaintext, conversationKey);
  recordSample('nip44Encrypt', performance.now() - t0);
  scheduleSummary();
  return result;
}

/**
 * sk+pk-shaped NIP-44 decrypt: derive the conversation key and decrypt in
 * one call. This is the native-routable twin of nip44Decrypt — rust-nostr's
 * FFI takes (secretKey, peerPubkey) and derives the conversation key
 * internally. Throws on invalid ciphertext in BOTH implementations; native
 * errors are NOT retried on JS (that would double the cost of every junk
 * wrap a relay feeds us — callers already catch-and-skip).
 */
export function nip44DecryptFrom(
  ciphertext: string,
  secretKey: Uint8Array,
  peerPublicKey: string,
): string {
  const native = nativeIfActive();
  if (!native) {
    return nip44Decrypt(ciphertext, nip44GetConversationKey(secretKey, peerPublicKey));
  }
  const pub = peerPublicKey.toLowerCase();
  const t0 = Date.now();
  let result: string | undefined;
  let nativeError: unknown;
  try {
    result = native.nip44Decrypt(bytesToHex(secretKey), pub, ciphertext);
  } catch (error) {
    nativeError = error;
  }
  // Sample successful decrypts only, mirroring the JS path where a throw
  // aborts before recordSample — keeps native/JS p50/p95 comparable.
  if (PERF_ENABLED && nativeError === undefined) {
    recordSample('nip44Decrypt', Date.now() - t0);
    scheduleSummary();
  }
  if (flags.xcheck) {
    let jsResult: string | undefined;
    let jsError: unknown;
    try {
      jsResult = nip44.v2.decrypt(ciphertext, nip44GetConversationKey(secretKey, pub));
    } catch (error) {
      jsError = error;
    }
    if (nativeError === undefined && jsError === undefined && result !== jsResult) {
      reportMismatch(
        'nip44DecryptFrom',
        `plaintext differs (len ${result?.length} vs ${jsResult?.length})`,
      );
    } else if ((nativeError === undefined) !== (jsError === undefined)) {
      reportMismatch(
        'nip44DecryptFrom',
        `one impl threw (native: ${nativeError ? 'threw' : 'ok'}, js: ${jsError ? 'threw' : 'ok'})`,
      );
    }
  }
  if (nativeError !== undefined) throw nativeError;
  return result as string;
}

/**
 * Convenience wrapper: derive conversation key from sk+pk and encrypt in one
 * call. Matches `nip44EncryptForRecipient` in nostrService.ts. Routes to the
 * native module when active; NIP-44 payloads are nonce-randomised so the two
 * implementations can't be compared byte-for-byte — the cross-check instead
 * requires the JS impl to decrypt the native payload back to the plaintext.
 */
export function nip44EncryptForRecipient(
  plaintext: string,
  senderSecretKey: Uint8Array,
  recipientPubkey: string,
): string {
  const native = nativeIfActive();
  if (!native) {
    const conversationKey = nip44GetConversationKey(senderSecretKey, recipientPubkey);
    return nip44Encrypt(plaintext, conversationKey);
  }
  const pub = recipientPubkey.toLowerCase();
  const t0 = Date.now();
  const payload = native.nip44Encrypt(bytesToHex(senderSecretKey), pub, plaintext);
  if (PERF_ENABLED) {
    recordSample('nip44Encrypt', Date.now() - t0);
    scheduleSummary();
  }
  if (flags.xcheck) {
    try {
      const roundTrip = nip44.v2.decrypt(payload, nip44GetConversationKey(senderSecretKey, pub));
      if (roundTrip !== plaintext) {
        reportMismatch(
          'nip44EncryptForRecipient',
          'js-decrypt(native-payload) differs from plaintext',
        );
      }
    } catch (error) {
      reportMismatch(
        'nip44EncryptForRecipient',
        `js-decrypt(native-payload) threw: ${(error as Error)?.message ?? 'unknown'}`,
      );
    }
  }
  return payload;
}

/**
 * Sign an unsigned event with a secret key (schnorr). Wraps
 * nostr-tools' `finalizeEvent`; benchmarked as schnorrSign.
 */
export function nostrFinalizeEvent(
  event: { kind: number; created_at: number; tags: string[][]; content: string },
  secretKey: Uint8Array,
): VerifiedEvent {
  if (!PERF_ENABLED) {
    return finalizeEvent(event, secretKey);
  }
  const t0 = performance.now();
  const result = finalizeEvent(event, secretKey);
  recordSample('schnorrSign', performance.now() - t0);
  scheduleSummary();
  return result;
}

/**
 * Verify a signed Nostr event (schnorr signature check). Wraps
 * nostr-tools' `verifyEvent`; benchmarked as schnorrVerify.
 *
 * Native path replicates verifyEvent's exact semantics: memoised via
 * nostr-tools' verifiedSymbol (so SimplePool and our pool.verifyEvent
 * override still see the marker), id must equal the recomputed hash, and
 * any malformed input verifies false rather than throwing. Only the
 * schnorr check itself (the ~25 ms part) moves to rust-nostr — the
 * canonical-serialisation sha256 stays in JS (getEventHash, ~µs).
 */
export function nostrVerifyEvent(event: NostrEvent): event is VerifiedEvent {
  const native = nativeIfActive();
  if (native) {
    const memoised = event[verifiedSymbol];
    if (typeof memoised === 'boolean') return memoised;
    const t0 = Date.now();
    let valid = false;
    try {
      const hash = getEventHash(event);
      valid =
        hash === event.id &&
        native.schnorrVerify(event.sig.toLowerCase(), hash, event.pubkey.toLowerCase());
    } catch {
      valid = false;
    }
    if (PERF_ENABLED) {
      recordSample('schnorrVerify', Date.now() - t0);
      scheduleSummary();
    }
    if (flags.xcheck) {
      // Compare BEFORE stamping the symbol so the JS verifier actually runs.
      const jsValid = verifyEvent({ ...event });
      if (jsValid !== valid) {
        reportMismatch('nostrVerifyEvent', `native=${valid} js=${jsValid} id=${event.id}`);
      }
    }
    event[verifiedSymbol] = valid;
    return valid;
  }
  if (!PERF_ENABLED) {
    return verifyEvent(event);
  }
  const t0 = performance.now();
  const result = verifyEvent(event);
  recordSample('schnorrVerify', performance.now() - t0);
  scheduleSummary();
  return result;
}

/**
 * Hash a Nostr event to produce its id (SHA-256 of the canonical
 * serialisation). Wraps nostr-tools' `getEventHash`.
 */
export function nostrGetEventHash(
  event: Pick<UnsignedEvent, 'pubkey' | 'created_at' | 'kind' | 'tags' | 'content'>,
): string {
  if (!PERF_ENABLED) {
    return getEventHash(event as UnsignedEvent);
  }
  const t0 = performance.now();
  const result = getEventHash(event as UnsignedEvent);
  recordSample('eventHash', performance.now() - t0);
  scheduleSummary();
  return result;
}

// ---------------------------------------------------------------------------
// Test-only exports (prefixed __) — flush summary immediately + reset state.
// ---------------------------------------------------------------------------

/** @internal Test use only — reset all accumulated stats. */
export function __resetStats(): void {
  for (const s of Object.values(stats)) {
    s.samples = [];
    s.count = 0;
  }
  lastSummaryAt = 0;
  summaryScheduled = false;
}

/** @internal Test use only — force a summary flush right now. */
export function __flushSummary(): void {
  lastSummaryAt = 0;
  summaryScheduled = false;
  for (const [op, s] of Object.entries(stats)) {
    if (s.count === 0) continue;
    const { p50, p95 } = percentiles(s.samples);
    console.log(`[PerfBlock] nostrCrypto ${op} n=${s.count} p50=${p50}ms p95=${p95}ms`);
  }
}

/** @internal Test use only — return a snapshot of accumulated stats. */
export function __getStats(): Record<string, { count: number; samples: number[] }> {
  const snapshot: Record<string, { count: number; samples: number[] }> = {};
  for (const [op, s] of Object.entries(stats)) {
    snapshot[op] = { count: s.count, samples: s.samples.slice() };
  }
  return snapshot;
}
