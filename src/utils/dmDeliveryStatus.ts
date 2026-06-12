// Delivery-status plumbing for sent NIP-17 DMs (#856). A send fans a
// gift-wrap out to N relays; today the send path collapses the per-relay
// outcome via `Promise.any` ("≥1 relay accepted"). This module captures the
// per-relay accept/reject so a sent bubble can show a delivery tick and, on
// long-press, a "sent to X of Y relays" breakdown.
//
// VISIBILITY ONLY — it does NOT change the partial-send = failure semantics
// in useMessageSend, and adds no retry. The outbox/retry work is #857.

// Per-relay publish outcome for one sent message, keyed by relay URL.
// `ok` = at least one of this send's wraps was accepted by that relay;
// `failed` = the relay rejected / errored for every wrap we tried.
export type RelayDeliveryResult = 'ok' | 'failed';

// Attached to a sent (fromMe) message so the bubble can render its tick and
// the per-relay breakdown survives a thread reload (persisted in the DM
// cache alongside the message). `undefined` on a message = legacy / received
// row with no delivery tracking — render no tick.
export interface DeliveryStatus {
  // True once ≥1 relay accepted ≥1 wrap. Mirrors the existing `Promise.any`
  // success signal, so the tick shows for exactly the sends that already
  // count as "sent" today.
  delivered: boolean;
  relayResults: Record<string, RelayDeliveryResult>;
}

// One relay's settled publish outcomes across all of a send's wraps. The
// recipient wrap and the self-copy wrap each publish to the same relay list,
// so a relay can appear with one settle per wrap. We fold them: a relay is
// `ok` if it accepted ANY wrap (delivery to that relay is proven by a single
// ack), `failed` only if every wrap to it rejected.
export interface RelaySettle {
  relay: string;
  ok: boolean;
}

/**
 * Fold per-relay, per-wrap settle results into a single `DeliveryStatus`.
 *
 * Pure + dependency-free so it's unit-testable in isolation (ok / partial /
 * all-fail). Each entry is one wrap's outcome at one relay; the same relay
 * may appear multiple times (once per wrap). A relay is `ok` if it accepted
 * at least one wrap.
 */
export function aggregateRelayResults(settles: RelaySettle[]): DeliveryStatus {
  const relayResults: Record<string, RelayDeliveryResult> = {};
  for (const s of settles) {
    // Once a relay is `ok` (accepted some wrap) it stays `ok` — a later
    // wrap's failure to the same relay doesn't downgrade proven delivery.
    if (s.ok) {
      relayResults[s.relay] = 'ok';
    } else if (relayResults[s.relay] !== 'ok') {
      relayResults[s.relay] = 'failed';
    }
  }
  const delivered = Object.values(relayResults).some((r) => r === 'ok');
  return { delivered, relayResults };
}

/** Count of relays that accepted, and the total relays attempted. Drives the
 * breakdown copy ("Sent to 4 of 6 relays"). */
export function summariseDelivery(status: DeliveryStatus): { ok: number; total: number } {
  const values = Object.values(status.relayResults);
  return { ok: values.filter((r) => r === 'ok').length, total: values.length };
}

/** Strip the `wss://` / `ws://` scheme and trailing slash for a compact relay
 * label in the breakdown sheet. */
export function shortRelayLabel(url: string): string {
  return url.replace(/^wss?:\/\//, '').replace(/\/$/, '');
}
