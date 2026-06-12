import type { VerifiedEvent } from 'nostr-tools/pure';
import { pool } from './nostrService';
import {
  aggregateRelayResults,
  type DeliveryStatus,
  type RelaySettle,
} from '../utils/dmDeliveryStatus';

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
 * Replaces the old `Promise.any` collapse (which only knew "≥1 relay
 * accepted"). The `wrapsPublished` / `errors` fields are preserved exactly so
 * existing callers' partial-send-as-failure logic is unchanged — #856 is
 * delivery VISIBILITY only; the retry/outbox work is #857. The added
 * `delivery` field carries the per-relay detail for the bubble's tick.
 *
 * `pool.publish(relays, event)` returns one promise per relay, in the same
 * order as `relays` — so a settle maps back to its relay URL by index.
 */
export async function publishWrapsTrackingRelays(
  wraps: VerifiedEvent[],
  relays: string[],
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
      // A wrap counts as published if ≥1 relay accepted it — same threshold
      // the old `Promise.any` used. A wrap no relay accepted records the first
      // rejection reason (mirrors the prior `errors.push` behaviour).
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
