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

// Fires with the FINAL per-relay breakdown once every relay has settled (or hit
// nostr-tools' publish timeout). The send itself resolves early — as soon as
// each wrap has a known outcome — so the optimistic bubble isn't blocked on a
// slow relay; this later call lets the tick upgrade from "fast relays only" to
// the complete single→double picture (#857).
export type OnDeliveryFinalized = (delivery: DeliveryStatus) => void;

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
  // Optional: called once with the COMPLETE breakdown after every relay has
  // settled (#857). The send resolves early; this fires later so a slow relay
  // can upgrade the tick (e.g. single → double) without delaying the bubble.
  onFinalized?: OnDeliveryFinalized,
): Promise<DmSendResult> {
  const errors: string[] = [];
  let published = 0;
  // Settles seen so far, shared across the early-resolve and background phases.
  // A relay that accepts ANY wrap is `ok`; aggregateRelayResults folds repeats.
  const settles: RelaySettle[] = [];
  // Per-wrap promises that complete only once EVERY relay for that wrap has
  // settled — awaited in the background for the final breakdown.
  const fullSettlePromises: Promise<void>[] = [];

  await Promise.all(
    wraps.map(async (wrap) => {
      const perRelay = pool.publish(relays, wrap);
      // Record each relay's outcome into the shared `settles` as soon as it
      // resolves/rejects, so the early snapshot reflects whatever has landed.
      const tagged = perRelay.map((p, i) => {
        const relay = relays[i];
        return p.then(
          () => settles.push({ relay, ok: true }),
          () => settles.push({ relay, ok: false }),
        );
      });
      // Whole-wrap settle (background) — feeds the final snapshot only.
      fullSettlePromises.push(Promise.allSettled(tagged).then(() => undefined));

      // Decide this wrap's published/error status as soon as it's KNOWN: the
      // first accept wins immediately; `Promise.any` rejects (AggregateError)
      // only once every relay has rejected — exactly the slow path we want.
      try {
        await Promise.any(perRelay);
        published++;
      } catch (e) {
        // Pull the first individual reason so the message is a concrete relay
        // error, not the AggregateError "all promises were rejected" wrapper.
        const agg = e as AggregateError;
        const firstReason = agg?.errors?.[0] as Error | undefined;
        errors.push(firstReason?.message ?? (e as Error)?.message ?? 'publish failed');
      }
    }),
  );

  // Background-finalize: once every relay has settled, hand the caller the
  // complete breakdown so a still-in-flight relay can settle the tick.
  if (onFinalized) {
    void Promise.all(fullSettlePromises).then(() =>
      onFinalized(aggregateRelayResults(settles, meta)),
    );
  }

  return { wrapsPublished: published, errors, delivery: aggregateRelayResults(settles, meta) };
}
