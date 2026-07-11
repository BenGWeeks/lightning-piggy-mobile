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

import * as nip44 from 'nostr-tools/nip44';
import {
  finalizeEvent,
  getEventHash,
  verifyEvent,
  type Event as NostrEvent,
  type VerifiedEvent,
  type UnsignedEvent,
} from 'nostr-tools/pure';

// ---------------------------------------------------------------------------
// Perf gate — matches perfLog.ts pattern exactly (gated on build-time env,
// not __DEV__ alone so it fires in EXPO_PUBLIC_KEEP_PERF_LOGS preview APKs).
// ---------------------------------------------------------------------------
const PERF_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_KEEP_PERF_LOGS === '1';

// ---------------------------------------------------------------------------
// Sliding window — keeps the most recent MAX_SAMPLES timing samples per op
// (oldest sample evicted via shift when the window is full).
// ---------------------------------------------------------------------------
const MAX_SAMPLES = 200;

interface OpStats {
  samples: number[];
  count: number;
  /** `count` at the last emitted summary — ops with no new samples since
   *  then are skipped, so a long-idle op doesn't log forever. */
  countAtLastSummary: number;
}

const stats: Record<string, OpStats> = {
  nip44Decrypt: { samples: [], count: 0, countAtLastSummary: 0 },
  nip44Encrypt: { samples: [], count: 0, countAtLastSummary: 0 },
  schnorrSign: { samples: [], count: 0, countAtLastSummary: 0 },
  schnorrVerify: { samples: [], count: 0, countAtLastSummary: 0 },
  eventHash: { samples: [], count: 0, countAtLastSummary: 0 },
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
  // (len - 1) * p matches the repo's existing percentile convention
  // (friendsOfFriendsService.bench.ts) — `len * p` skews indexes high.
  const p50 = sorted[Math.floor((sorted.length - 1) * 0.5)] ?? 0;
  const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0;
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
      if (s.count === s.countAtLastSummary) continue;
      s.countAtLastSummary = s.count;
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
 * Convenience wrapper: derive conversation key from sk+pk and encrypt in one
 * call. Matches `nip44EncryptForRecipient` in nostrService.ts.
 */
export function nip44EncryptForRecipient(
  plaintext: string,
  senderSecretKey: Uint8Array,
  recipientPubkey: string,
): string {
  const conversationKey = nip44GetConversationKey(senderSecretKey, recipientPubkey);
  return nip44Encrypt(plaintext, conversationKey);
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
 */
export function nostrVerifyEvent(event: NostrEvent): event is VerifiedEvent {
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
// Test-only exports (prefixed __) — force a summary flush, or reset state.
// ---------------------------------------------------------------------------

/** @internal Test use only — reset all accumulated stats. */
export function __resetStats(): void {
  for (const s of Object.values(stats)) {
    s.samples = [];
    s.count = 0;
    s.countAtLastSummary = 0;
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
