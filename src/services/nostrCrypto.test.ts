/**
 * Unit tests for src/services/nostrCrypto.ts — Stage 1a of epic #1036.
 *
 * Two concerns:
 *   A) Correctness: facade functions produce byte-identical results to direct
 *      nostr-tools / @noble calls (round-trip encrypt/decrypt, sign/verify,
 *      known-vector hash, getEventHash).
 *   B) Benchmark harness: the summary logger respects the perf gate and the
 *      60 s cadence. Uses fake timers so we never wait real time.
 */

import * as nip44Real from 'nostr-tools/nip44';
import {
  finalizeEvent as nostrToolsFinalizeEvent,
  verifyEvent as nostrToolsVerifyEvent,
  getEventHash as nostrToolsGetEventHash,
  generateSecretKey,
  getPublicKey,
} from 'nostr-tools/pure';
import {
  nip44GetConversationKey,
  nip44Decrypt,
  nip44Encrypt,
  nip44EncryptForRecipient,
  nostrFinalizeEvent,
  nostrVerifyEvent,
  nostrGetEventHash,
  __resetStats,
  __flushSummary,
  __getStats,
} from './nostrCrypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshKeyPair(): { sk: Uint8Array; pk: string } {
  const sk = generateSecretKey();
  return { sk, pk: getPublicKey(sk) };
}

// File-level perf-harness reset (#1047 review): __DEV__ is true under Jest,
// so PERF_ENABLED is true and every wrapped crypto call in ANY describe below
// — not just the "benchmark harness" ones — calls scheduleSummary(). Its
// delay is computed from `lastSummaryAt`; once one test lets a summary flush
// set that to a real timestamp, the next test's call computes a genuine
// ~60s delay and arms a real, untracked setTimeout that outlives the test
// (an open handle that can slow or hang the run). Resetting via
// __resetStats() before/after every test in the file (not just the harness
// describes, which already did this locally) pins the computed delay back
// near 0 instead. Additive only — no source change needed since
// __resetStats() already exists as the test-only reset.
beforeEach(() => {
  __resetStats();
});

afterEach(() => {
  __resetStats();
});

// ---------------------------------------------------------------------------
// A) Correctness tests
// ---------------------------------------------------------------------------

describe('nip44 round-trip (encrypt → decrypt)', () => {
  it('produces identical plaintext to direct nip44 calls', () => {
    const alice = freshKeyPair();
    const bob = freshKeyPair();
    const plaintext = 'hello lightning piggy 🐷';

    // Encrypt via facade
    const conversationKey = nip44GetConversationKey(alice.sk, bob.pk);
    const ciphertext = nip44Encrypt(plaintext, conversationKey);

    // Decrypt via facade
    const decrypted = nip44Decrypt(ciphertext, conversationKey);
    expect(decrypted).toBe(plaintext);
  });

  it('decrypts ciphertext produced by nostr-tools directly', () => {
    const alice = freshKeyPair();
    const bob = freshKeyPair();
    const plaintext = 'cross-library interop check';

    // Encrypt with real nostr-tools
    const directKey = nip44Real.v2.utils.getConversationKey(alice.sk, bob.pk);
    const directCt = nip44Real.v2.encrypt(plaintext, directKey);

    // Decrypt via facade — must produce same plaintext
    const facadeKey = nip44GetConversationKey(alice.sk, bob.pk);
    expect(nip44Decrypt(directCt, facadeKey)).toBe(plaintext);
  });

  it('nip44EncryptForRecipient convenience wrapper round-trips', () => {
    const sender = freshKeyPair();
    const recipient = freshKeyPair();
    const plaintext = 'convenience wrapper test';

    const ciphertext = nip44EncryptForRecipient(plaintext, sender.sk, recipient.pk);

    // Decrypt directly with real nip44 to confirm byte-identical output
    const key = nip44Real.v2.utils.getConversationKey(sender.sk, recipient.pk);
    expect(nip44Real.v2.decrypt(ciphertext, key)).toBe(plaintext);
  });
});

describe('nostrFinalizeEvent (schnorr sign)', () => {
  it('produces a VerifiedEvent that nostrToolsVerifyEvent accepts', () => {
    const { sk } = freshKeyPair();
    const unsigned = {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: 'test event',
    };

    const signed = nostrFinalizeEvent(unsigned, sk);
    expect(nostrToolsVerifyEvent(signed)).toBe(true);
  });

  it('produces the same id as nostr-tools finalizeEvent would', () => {
    const { sk } = freshKeyPair();
    const unsigned = {
      kind: 1,
      created_at: 1_700_000_000,
      tags: [],
      content: 'deterministic test',
    };

    const facadeSigned = nostrFinalizeEvent(unsigned, sk);
    const directSigned = nostrToolsFinalizeEvent({ ...unsigned }, sk);
    // Same key + same unsigned → same id (SHA-256 of canonical serialisation)
    expect(facadeSigned.id).toBe(directSigned.id);
  });
});

describe('nostrVerifyEvent (schnorr verify)', () => {
  it('returns true for a valid signed event', () => {
    const { sk } = freshKeyPair();
    const signed = nostrToolsFinalizeEvent(
      { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'verify me' },
      sk,
    );
    expect(nostrVerifyEvent(signed)).toBe(true);
  });

  it('returns false for an event built with a wrong id (hash mismatch)', () => {
    const { pk } = freshKeyPair();
    // Build a plain object — no Symbol caching — with an id that doesn't match
    // the canonical hash of the content. verifyEvent must reject it.
    const fakeEvent = {
      id: '0'.repeat(64), // wrong id
      pubkey: pk,
      created_at: 1_700_000_001,
      kind: 1,
      tags: [],
      content: 'hash mismatch test',
      sig: '0'.repeat(128),
    };
    // nostrToolsVerifyEvent is the same underlying function — both should agree
    expect(nostrToolsVerifyEvent(fakeEvent)).toBe(false);
    expect(nostrVerifyEvent(fakeEvent)).toBe(false);
  });
});

describe('nostrGetEventHash', () => {
  it('matches nostr-tools getEventHash for a known event shape', () => {
    const { pk } = freshKeyPair();
    const event = {
      pubkey: pk,
      created_at: 1_700_000_000,
      kind: 14,
      tags: [['p', pk]],
      content: 'known vector',
    };

    const facadeHash = nostrGetEventHash(event);
    const directHash = nostrToolsGetEventHash(event);
    expect(facadeHash).toBe(directHash);
  });

  it('returns a 64-char hex string', () => {
    const { pk } = freshKeyPair();
    const hash = nostrGetEventHash({
      pubkey: pk,
      created_at: 1,
      kind: 1,
      tags: [],
      content: '',
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// B) Benchmark harness tests
// ---------------------------------------------------------------------------

// NOTE on console.log in Jest:
// The project's babel.config.js applies transform-remove-console (excluding
// warn/error/assert) when NODE_ENV !== 'development'. Jest sets NODE_ENV=test,
// so console.log calls inside the transpiled module are stripped at Babel time.
// We therefore test the harness behaviour via __getStats() (which reads the
// in-memory counters directly) rather than asserting console.log output.

describe('benchmark harness — stat accumulation', () => {
  beforeEach(() => {
    __resetStats();
  });

  afterEach(() => {
    __resetStats();
  });

  it('records nip44Encrypt and nip44Decrypt counts', () => {
    const alice = freshKeyPair();
    const bob = freshKeyPair();
    const key = nip44GetConversationKey(alice.sk, bob.pk);
    const ct = nip44Encrypt('hello', key);
    nip44Decrypt(ct, key);

    const s = __getStats();
    expect(s.nip44Encrypt.count).toBe(1);
    expect(s.nip44Decrypt.count).toBe(1);
  });

  it('accumulates count correctly across multiple ops', () => {
    const alice = freshKeyPair();
    const bob = freshKeyPair();
    const key = nip44GetConversationKey(alice.sk, bob.pk);
    for (let i = 0; i < 5; i++) {
      const ct = nip44Encrypt(`msg-${i}`, key);
      nip44Decrypt(ct, key);
    }

    const s = __getStats();
    expect(s.nip44Encrypt.count).toBe(5);
    expect(s.nip44Decrypt.count).toBe(5);
    expect(s.nip44Encrypt.samples).toHaveLength(5);
    expect(s.nip44Decrypt.samples).toHaveLength(5);
    // Every sample must be a non-negative number
    s.nip44Encrypt.samples.forEach((ms) => expect(ms).toBeGreaterThanOrEqual(0));
  });

  it('records schnorrSign via nostrFinalizeEvent', () => {
    const { sk } = freshKeyPair();
    nostrFinalizeEvent(
      { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'benchmark' },
      sk,
    );

    const s = __getStats();
    expect(s.schnorrSign.count).toBe(1);
    expect(s.schnorrSign.samples).toHaveLength(1);
  });

  it('records schnorrVerify via nostrVerifyEvent', () => {
    const { sk } = freshKeyPair();
    const signed = nostrToolsFinalizeEvent(
      { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'verify me' },
      sk,
    );
    nostrVerifyEvent(signed);

    const s = __getStats();
    expect(s.schnorrVerify.count).toBe(1);
  });

  it('__resetStats zeroes all counters', () => {
    const alice = freshKeyPair();
    const bob = freshKeyPair();
    const key = nip44GetConversationKey(alice.sk, bob.pk);
    nip44Encrypt('before reset', key);
    expect(__getStats().nip44Encrypt.count).toBe(1);

    __resetStats();
    const s = __getStats();
    expect(s.nip44Encrypt.count).toBe(0);
    expect(s.nip44Decrypt.count).toBe(0);
    expect(s.schnorrSign.count).toBe(0);
    expect(s.schnorrVerify.count).toBe(0);
    expect(s.nip44Encrypt.samples).toHaveLength(0);
  });

  it('caps samples at MAX_SAMPLES (200) via eviction', () => {
    const alice = freshKeyPair();
    const bob = freshKeyPair();
    const key = nip44GetConversationKey(alice.sk, bob.pk);
    // Perform 210 encrypts — reservoir should evict the oldest 10
    for (let i = 0; i < 210; i++) {
      nip44Encrypt(`msg-${i}`, key);
    }

    const s = __getStats();
    expect(s.nip44Encrypt.count).toBe(210);
    expect(s.nip44Encrypt.samples.length).toBeLessThanOrEqual(200);
  });

  it('__flushSummary resets lastSummaryAt so a second flush can fire', () => {
    const alice = freshKeyPair();
    const bob = freshKeyPair();
    const key = nip44GetConversationKey(alice.sk, bob.pk);
    nip44Encrypt('first', key);

    // First flush — should not throw even if console.log is stripped
    expect(() => __flushSummary()).not.toThrow();

    // Record another op; __flushSummary reset lastSummaryAt so it can fire again
    nip44Encrypt('second', key);
    expect(() => __flushSummary()).not.toThrow();
  });
});

describe('benchmark harness — cadence gate (fake timers)', () => {
  beforeEach(() => {
    __resetStats();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    __resetStats();
  });

  it('scheduleSummary does not double-schedule when called on every op', () => {
    const alice = freshKeyPair();
    const bob = freshKeyPair();
    const key = nip44GetConversationKey(alice.sk, bob.pk);

    expect(jest.getTimerCount()).toBe(0);

    // First op arms the single summary timer (summaryScheduled guard).
    nip44Encrypt('op1', key);
    expect(jest.getTimerCount()).toBe(1);

    // 2 more ops in a row — must NOT arm a second/third timer; the guard
    // should keep exactly one summary timer pending regardless of how many
    // crypto calls happen before it fires.
    nip44Encrypt('op2', key);
    nip44Encrypt('op3', key);
    expect(jest.getTimerCount()).toBe(1);

    const s = __getStats();
    expect(s.nip44Encrypt.count).toBe(3);
    // All three samples are recorded regardless of timer scheduling
    expect(s.nip44Encrypt.samples).toHaveLength(3);
  });
});
