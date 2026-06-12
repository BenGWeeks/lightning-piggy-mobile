import type { VerifiedEvent } from 'nostr-tools/pure';
import {
  aggregateRelayResults,
  type DeliveryStatus,
  type RelaySettle,
} from '../utils/dmDeliveryStatus';

// Minimal structural view of nostr-tools' SimplePool — just the one method
// this module calls. Taking it as a parameter (rather than importing the
// concrete `pool` from `nostrService`) keeps this module a leaf with no
// dependency on `nostrService`, so there's no import cycle (Copilot #858).
export interface RelayPublisher {
  publish(relays: string[], event: VerifiedEvent): Promise<string>[];
}

// Result of a NIP-17 multi-wrap DM send. `wrapsPublished` / `errors` are the
// original fields callers' partial-send logic relies on; `delivery` is the
// added per-relay breakdown for the sent bubble's tick (#856).
export interface DmSendResult {
  wrapsPublished: number;
  errors: string[];
  delivery: DeliveryStatus;
}

/**
 * Publish a batch of gift-wraps to a relay set, capturing each relay's
 * per-wrap accept/reject (`Promise.allSettled` over the per-relay promises
 * `pool.publish` returns) and folding them into a single `DeliveryStatus`.
 *
 * `wrapsPublished` keeps the old `Promise.any` threshold — a wrap counts as
 * published once ≥1 relay accepts it. `errors` records, per fully-failed wrap,
 * the FIRST rejecting relay's message (a concrete relay error, deliberately
 * NOT the old `AggregateError` "all promises were rejected" text). The added
 * `delivery` field carries the per-relay detail for the bubble's tick; #856 is
 * delivery VISIBILITY only — the retry/outbox work is #857.
 *
 * `publish(relays, event)` returns one promise per relay, in the same order as
 * `relays` — so a settle maps back to its relay URL by index. The pool is
 * injected so this module stays a leaf (no `nostrService` import cycle).
 */
export async function publishWrapsTrackingRelays(
  wraps: VerifiedEvent[],
  relays: string[],
  pool: RelayPublisher,
  // Event identity (rumor id + kind) surfaced in the long-press detail sheet
  // (#856). Carried straight onto the resulting DeliveryStatus.
  meta?: { eventId?: string; kind?: number },
): Promise<DmSendResult> {
  const errors: string[] = [];
  let published = 0;
  const settles: RelaySettle[] = [];
  await Promise.all(
    wraps.map(async (wrap) => {
      const perRelay = pool.publish(relays, wrap);
      const results = await Promise.allSettled(perRelay);
      let anyOk = false;
      results.forEach((res, i) => {
        const relay = relays[i];
        const ok = res.status === 'fulfilled';
        if (ok) anyOk = true;
        settles.push({ relay, ok });
      });
      // A wrap counts as published once ≥1 relay accepts it (same threshold as
      // the old `Promise.any`). When every relay rejects, surface the first
      // relay's concrete error message rather than an AggregateError wrapper.
      if (anyOk) {
        published++;
      } else {
        const firstReject = results.find((r) => r.status === 'rejected') as
          | PromiseRejectedResult
          | undefined;
        errors.push((firstReject?.reason as Error)?.message ?? 'publish failed');
      }
    }),
  );
  return { wrapsPublished: published, errors, delivery: aggregateRelayResults(settles, meta) };
}
