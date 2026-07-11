// Dev-only benchmark for the #1046 native-crypto bring-up: 500 nip44
// decrypts + 500 schnorr verifies through BOTH implementations (pure-JS
// nostr-tools/@noble and the rust-nostr native module), logging p50/p95
// per op as [PerfBlock] lines for logcat capture.
//
// Deliberately bypasses the nostrCrypto facade and calls each impl
// directly — the point is to compare implementations, not the routing
// flag. Triggered from index.ts only when EXPO_PUBLIC_NATIVE_CRYPTO_BENCH=1
// (inlined at bundle time, so it is dead code in every normal build), and
// lazily imported so none of this touches cold start.

import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import * as nip44 from 'nostr-tools/nip44';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';

import { getNostrNative } from '../../modules/nostr-native';

const OPS = 500;
const UNIQUE_VECTORS = 50; // distinct counterparties/messages, cycled 10x each
const YIELD_EVERY = 25; // keep the JS-thread heartbeat alive mid-bench

const yieldToLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function percentile(sortedMs: number[], p: number): number {
  return sortedMs[Math.floor((sortedMs.length - 1) * p)];
}

function logBlock(op: string, impl: string, durationsMs: number[]): void {
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const total = durationsMs.reduce((sum, d) => sum + d, 0);
  console.log(
    `[PerfBlock] cryptoBench ${op} ${impl} n=${durationsMs.length} ` +
      `p50=${percentile(sorted, 0.5).toFixed(3)}ms p95=${percentile(sorted, 0.95).toFixed(3)}ms ` +
      `total=${total.toFixed(0)}ms`,
  );
}

async function measure(run: (index: number) => void): Promise<number[]> {
  const durations: number[] = [];
  for (let i = 0; i < OPS; i++) {
    const start = performance.now();
    run(i % UNIQUE_VECTORS);
    durations.push(performance.now() - start);
    if (i % YIELD_EVERY === YIELD_EVERY - 1) await yieldToLoop();
  }
  return durations;
}

export async function runNostrCryptoBench(): Promise<void> {
  console.log('[PerfBlock] cryptoBench start');

  // --- Vectors: one viewer key, 50 counterparties, seal-sized payloads ---
  const secretKey = generateSecretKey();
  const secretKeyHex = bytesToHex(secretKey);
  const publicKeyHex = getPublicKey(secretKey);

  const counterpartyPubkeys: string[] = [];
  const ciphertexts: string[] = [];
  // Seal-sized plaintext (~500 chars) approximating the wrap→seal layer of
  // a real NIP-17 gift wrap, the app's hottest decrypt.
  const plaintext = JSON.stringify({
    id: 'f'.repeat(64),
    pubkey: 'a'.repeat(64),
    created_at: 1730000000,
    kind: 13,
    tags: [],
    content: 'x'.repeat(320),
    sig: 'b'.repeat(128),
  });
  for (let i = 0; i < UNIQUE_VECTORS; i++) {
    const counterpartySecret = generateSecretKey();
    const counterpartyPub = getPublicKey(counterpartySecret);
    counterpartyPubkeys.push(counterpartyPub);
    const conversationKey = nip44.v2.utils.getConversationKey(secretKey, counterpartyPub);
    ciphertexts.push(nip44.v2.encrypt(plaintext, conversationKey));
    if (i % 10 === 9) await yieldToLoop();
  }

  const hashes: string[] = [];
  const signatures: string[] = [];
  for (let i = 0; i < UNIQUE_VECTORS; i++) {
    const hash = bytesToHex(sha256(new TextEncoder().encode(`bench-message-${i}`)));
    hashes.push(hash);
    signatures.push(bytesToHex(schnorr.sign(hexToBytes(hash), secretKey)));
    if (i % 10 === 9) await yieldToLoop();
  }

  // Every timed op's result is asserted: consuming the value prevents any
  // optimizer from eliding the work under measurement, and a correctness
  // regression aborts the bench instead of producing bogus numbers.
  const assertOp = (ok: boolean, what: string) => {
    if (!ok) throw new Error(`cryptoBench ${what} produced a wrong result`);
  };

  // --- JS baseline ---
  const jsDecrypt = await measure((i) => {
    // Conversation-key derivation (ECDH+HKDF) is part of the per-wrap cost
    // in unwrapWrapNsec (ephemeral wrap keys), so derive per op like prod.
    const key = nip44.v2.utils.getConversationKey(secretKey, counterpartyPubkeys[i]);
    assertOp(nip44.v2.decrypt(ciphertexts[i], key) === plaintext, 'js decrypt');
  });
  logBlock('nip44-decrypt', 'js', jsDecrypt);

  const jsVerify = await measure((i) => {
    assertOp(
      schnorr.verify(hexToBytes(signatures[i]), hexToBytes(hashes[i]), hexToBytes(publicKeyHex)),
      'js verify',
    );
  });
  logBlock('schnorr-verify', 'js', jsVerify);

  // --- Native ---
  const native = getNostrNative();
  if (!native) {
    console.log('[PerfBlock] cryptoBench native: MODULE NOT LINKED — skipped');
    return;
  }
  const warmed = await native.warmUp();
  if (!warmed) {
    console.log('[PerfBlock] cryptoBench native: warmUp failed — skipped');
    return;
  }
  // Correctness gates: never benchmark a failure path.
  const nativePlain = native.nip44Decrypt(secretKeyHex, counterpartyPubkeys[0], ciphertexts[0]);
  if (nativePlain !== plaintext) {
    console.error('[PerfBlock] cryptoBench native decrypt output DIFFERS from JS — aborting');
    return;
  }
  if (!native.schnorrVerify(signatures[0], hashes[0], publicKeyHex)) {
    console.error('[PerfBlock] cryptoBench native verify rejected a valid signature — aborting');
    return;
  }

  const nativeDecrypt = await measure((i) => {
    assertOp(
      native.nip44Decrypt(secretKeyHex, counterpartyPubkeys[i], ciphertexts[i]) === plaintext,
      'native decrypt',
    );
  });
  logBlock('nip44-decrypt', 'native', nativeDecrypt);

  const nativeVerify = await measure((i) => {
    assertOp(native.schnorrVerify(signatures[i], hashes[i], publicKeyHex), 'native verify');
  });
  logBlock('schnorr-verify', 'native', nativeVerify);

  console.log('[PerfBlock] cryptoBench done');
}
