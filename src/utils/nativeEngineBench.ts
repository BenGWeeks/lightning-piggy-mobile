// Dev-only benchmark for the #1049 native relay engine: the reconnect-
// backlog drill. Drains the SAME synthetic 200-wrap kind-1059 backlog from a
// local bench relay (scripts/bench-engine-relay.mjs, reachable from the
// emulator at ws://10.0.2.2:4870) through BOTH paths:
//
//   js     — SimplePool sub + per-wrap yieldToEventLoop + unwrapWrapNsec,
//            the live sub's exact per-wrap pipeline shape;
//   engine — the native rust-nostr pool (verify + NIP-59 unwrap off-thread),
//            batched plaintext rumors to JS.
//
// Reports wall-clock (subscribe → last wrap processed) and JS-thread
// heartbeat gaps (max + p95 of a 50 ms self-timer's lateness) per phase as
// [PerfBlock] engineBench lines for logcat capture. Triggered from index.ts
// only when EXPO_PUBLIC_NATIVE_ENGINE_BENCH=1 (inlined at bundle time —
// dead code in every normal build), lazily imported, __DEV__-gated.

import { SimplePool } from 'nostr-tools/pool';
import type { Filter } from 'nostr-tools/filter';
import { hexToBytes } from '@noble/hashes/utils.js';
import { getPublicKey } from 'nostr-tools/pure';
import { unwrapWrapNsec } from './nip17Unwrap';
import type { RawGiftWrapEvent } from '../services/nostrService';
import { yieldToEventLoop } from '../contexts/nostrDecryptPacing';
import { getNostrEngine } from '../../modules/nostr-native';

// Shared with scripts/bench-engine-relay.mjs. Bench-only throwaway key.
const BENCH_RECEIVER_SK_HEX = '11'.repeat(32);
const BENCH_RELAY = process.env.EXPO_PUBLIC_NATIVE_ENGINE_BENCH_RELAY ?? 'ws://10.0.2.2:4870';
const TARGET_WRAPS = 200;
const PHASE_TIMEOUT_MS = 180_000;
const GAP_SAMPLE_MS = 50;

interface GapStats {
  n: number;
  maxMs: number;
  p95Ms: number;
}

/** 50 ms self-timer; every tick's lateness is a JS-thread occupancy gap. */
function startGapSampler(): { stop: () => GapStats } {
  const gaps: number[] = [];
  let active = true;
  let expectedAt = Date.now() + GAP_SAMPLE_MS;
  const tick = (): void => {
    if (!active) return;
    const now = Date.now();
    gaps.push(now - expectedAt);
    expectedAt = now + GAP_SAMPLE_MS;
    setTimeout(tick, GAP_SAMPLE_MS);
  };
  setTimeout(tick, GAP_SAMPLE_MS);
  return {
    stop: () => {
      active = false;
      const sorted = [...gaps].sort((a, b) => a - b);
      return {
        n: gaps.length,
        maxMs: sorted[sorted.length - 1] ?? 0,
        p95Ms: sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0,
      };
    },
  };
}

function withTimeout(p: Promise<void>, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${PHASE_TIMEOUT_MS} ms`)),
      PHASE_TIMEOUT_MS,
    );
    p.then(() => {
      clearTimeout(timer);
      resolve();
    }, reject);
  });
}

function logPhase(
  impl: string,
  processed: number,
  t0: number,
  firstAt: number,
  lastAt: number,
  stats: GapStats,
): void {
  console.log(
    `[PerfBlock] engineBench ${impl} wraps=${processed} sub→first=${firstAt - t0}ms ` +
      `first→last=${lastAt - firstAt}ms total=${lastAt - t0}ms ` +
      `hbGapMax=${stats.maxMs}ms hbGapP95=${stats.p95Ms}ms (n=${stats.n})`,
  );
}

async function runJsPhase(secretKey: Uint8Array, pubkeyHex: string): Promise<void> {
  const pool = new SimplePool();
  const knownWrapIds = new Set<string>();
  const sampler = startGapSampler();
  let processed = 0;
  let firstAt = 0;
  let lastAt = 0;
  let done!: () => void;
  const finished = new Promise<void>((resolve) => (done = resolve));
  const t0 = Date.now();
  const sub = pool.subscribeMany(
    [BENCH_RELAY],
    { kinds: [1059], '#p': [pubkeyHex], limit: TARGET_WRAPS } as Filter,
    {
      onevent: (ev) => {
        // Fire-and-forget per event, like the live sub's handleInboxEvent.
        void (async () => {
          if (knownWrapIds.has(ev.id)) return;
          knownWrapIds.add(ev.id);
          if (firstAt === 0) firstAt = Date.now();
          // The live sub's per-wrap pacing yield (#496) + sync two-layer unwrap.
          await yieldToEventLoop();
          const rumor = unwrapWrapNsec(ev as RawGiftWrapEvent, secretKey);
          if (!rumor || !rumor.content.startsWith('engine-bench')) {
            console.error('[PerfBlock] engineBench js produced a wrong rumor — aborting');
            done();
            return;
          }
          processed += 1;
          lastAt = Date.now();
          if (processed >= TARGET_WRAPS) done();
        })();
      },
    },
  );
  try {
    await withTimeout(finished, 'js phase');
  } finally {
    sub.close();
    pool.close([BENCH_RELAY]);
  }
  logPhase('js', processed, t0, firstAt, lastAt, sampler.stop());
}

async function runEnginePhase(secretKeyHex: string, pubkeyHex: string): Promise<void> {
  const engine = getNostrEngine();
  if (!engine) {
    console.log('[PerfBlock] engineBench native: ENGINE NOT LINKED — skipped');
    return;
  }
  const sampler = startGapSampler();
  let processed = 0;
  let firstAt = 0;
  let lastAt = 0;
  let done!: () => void;
  const finished = new Promise<void>((resolve) => (done = resolve));
  const sub = engine.addListener('onEngineRumorBatch', (event) => {
    if (firstAt === 0) firstAt = Date.now();
    const entries = JSON.parse(event.rumorsJson) as { rumor: { content: string } }[];
    for (const entry of entries) {
      if (!entry.rumor.content.startsWith('engine-bench')) {
        console.error('[PerfBlock] engineBench native produced a wrong rumor — aborting');
        done();
        return;
      }
    }
    processed += entries.length;
    lastAt = Date.now();
    if (processed >= TARGET_WRAPS) done();
  });
  const t0 = Date.now();
  try {
    await engine.engineStart([BENCH_RELAY], pubkeyHex, secretKeyHex);
    await engine.engineSubscribeWraps(
      JSON.stringify({ kinds: [1059], '#p': [pubkeyHex], limit: TARGET_WRAPS }),
      [],
    );
    await withTimeout(finished, 'engine phase');
  } finally {
    sub.remove();
    await engine.engineStop().catch(() => {});
  }
  logPhase('native', processed, t0, firstAt, lastAt, sampler.stop());
}

export async function runNativeEngineBench(): Promise<void> {
  console.log(`[PerfBlock] engineBench start (relay=${BENCH_RELAY}, target=${TARGET_WRAPS})`);
  const secretKey = hexToBytes(BENCH_RECEIVER_SK_HEX);
  const pubkeyHex = getPublicKey(secretKey);
  await runJsPhase(secretKey, pubkeyHex);
  // Let the JS phase's trailing timers/GC settle before the second phase.
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  await runEnginePhase(BENCH_RECEIVER_SK_HEX, pubkeyHex);
  console.log('[PerfBlock] engineBench done');
}
