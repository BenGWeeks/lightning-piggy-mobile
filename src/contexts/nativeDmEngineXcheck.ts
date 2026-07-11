/**
 * Dev-only cross-check for the native relay engine (Stage 2 M2, #1036).
 *
 * With EXPO_PUBLIC_NATIVE_ENGINE_XCHECK=1 the live DM sub runs BOTH paths:
 * the JS SimplePool wrap subscription (which keeps surfacing messages
 * exactly as today) and the native engine in observe-only mode. Each side
 * records the wrap ids it successfully unwrapped; a sweep compares them
 * after a settle window and console.errors any id one side delivered that
 * the other didn't — loud enough to catch a dedupe/unwrap divergence during
 * dev soak without changing user-visible behaviour.
 *
 * Known, deliberate asymmetries (logged as errors anyway so a human judges):
 *  - The pool verifies wrap signatures natively; the JS path skips wrap-sig
 *    verification by design (#802 — the NIP-44 MAC carries integrity). A
 *    wrap with a bogus sig unwraps on JS but is dropped natively.
 *  - Relay-side limit ordering can differ between the two independent REQs
 *    when the inbox is deeper than `wrapsLimit` (#469 random timestamps).
 */

const SWEEP_INTERVAL_MS = 10_000;
/** An id must be at least this old before a one-sided delivery counts as a
 * divergence — the two paths race the same relays, so give the slower one a
 * fair window to catch up. */
const SETTLE_MS = 20_000;
const MAX_TRACKED = 4096;

export interface EngineXcheck {
  recordJs(wrapId: string): void;
  recordEngine(wrapId: string): void;
  dispose(): void;
}

export function createEngineXcheck(): EngineXcheck {
  const js = new Map<string, number>(); // wrapId -> first-seen ms
  const engine = new Map<string, number>();
  const reported = new Set<string>();

  const record = (map: Map<string, number>, wrapId: string): void => {
    if (!map.has(wrapId)) map.set(wrapId, Date.now());
    if (map.size > MAX_TRACKED) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
  };

  const sweep = (): void => {
    const now = Date.now();
    for (const [wrapId, seenAt] of js) {
      if (now - seenAt < SETTLE_MS || engine.has(wrapId) || reported.has(wrapId)) continue;
      reported.add(wrapId);
      console.error(
        `[NostrEngine] XCHECK DIVERGENCE: JS unwrapped ${wrapId.slice(0, 12)}… but the native engine did not`,
      );
    }
    for (const [wrapId, seenAt] of engine) {
      if (now - seenAt < SETTLE_MS || js.has(wrapId) || reported.has(wrapId)) continue;
      reported.add(wrapId);
      console.error(
        `[NostrEngine] XCHECK DIVERGENCE: native engine unwrapped ${wrapId.slice(0, 12)}… but JS did not`,
      );
    }
  };

  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);

  return {
    recordJs: (wrapId) => record(js, wrapId),
    recordEngine: (wrapId) => record(engine, wrapId),
    dispose: () => {
      clearInterval(timer);
      js.clear();
      engine.clear();
      reported.clear();
    },
  };
}
