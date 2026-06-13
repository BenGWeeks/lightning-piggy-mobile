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
  // How many relays the send ATTEMPTED — the full target set, not just the
  // relays that have settled so far (#857). The early/optimistic snapshot only
  // has settles for the fast relays, so `relayResults` undercounts; `total`
  // must reflect the attempted count or a single fast ack reads as "all relays"
  // (ok === total) and shows a premature double-tick. Undefined on legacy rows
  // / pre-publish failures → callers fall back to the settled-relay count.
  targetRelayCount?: number;
  // Optional event identity for the long-press detail sheet (#856). `eventId`
  // is the NIP-17 rumor id (the stable inner kind-14/15 event id, shared
  // across the recipient + self wraps); `kind` is the rumor kind (14 text,
  // 15 file). Best-effort — older persisted rows won't carry them.
  eventId?: string;
  kind?: number;
  // True while the send is still in flight — no relay has settled yet (#857).
  // Drives the faint pending Clock, distinguishing an optimistic bubble from an
  // all-failed send (which also has zero `ok` relays, but renders the red
  // AlertCircle). Cleared once the publish resolves.
  pending?: boolean;
}

// Status for an optimistic bubble that's still publishing (#857): no relay has
// settled yet, so the tick renders the faint pending Clock.
export function pendingDelivery(meta?: { eventId?: string; kind?: number }): DeliveryStatus {
  return { delivered: false, relayResults: {}, pending: true, ...meta };
}

// Status for a send that produced NO delivery at all — a hard error before the
// publish stage (not logged in, signer cancelled, invalid key). The bubble
// shows the red failed glyph; `relayResults` is empty because nothing landed.
export function failedDelivery(meta?: { eventId?: string; kind?: number }): DeliveryStatus {
  return { delivered: false, relayResults: {}, ...meta };
}

// Everything the message-info sheet needs for ONE message — sent or received
// (#856). For a sent message `deliveryStatus` carries the per-relay tick +
// Re-publish payload; for a received message it's absent and we just show the
// metadata (protocol / kind / id). `wireKind` distinguishes NIP-17
// (gift-wrapped, kind 14/15) from legacy NIP-04 (kind 4).
export interface MessageInfo {
  direction: 'sent' | 'received';
  eventId: string;
  // The on-wire protocol: 4 = NIP-04, 14/15 = NIP-17 rumor kind.
  wireKind?: number;
  // Present only for sent messages — drives the relay breakdown + tick.
  deliveryStatus?: DeliveryStatus;
  // Raw text to hand Re-publish (sent kind-14 only); empty otherwise.
  resendText?: string;
}

/** Human label for the wire protocol shown in the message-info sheet. */
export function protocolLabel(wireKind: number | undefined): string {
  if (wireKind === 4) return 'NIP-04 (legacy DM)';
  if (wireKind === 14 || wireKind === 15) return 'NIP-17 (gift-wrapped)';
  return 'Unknown';
}

/** Whether a message travelled as an encrypted NIP-17 gift wrap. */
export function isGiftWrapped(wireKind: number | undefined): boolean {
  return wireKind === 14 || wireKind === 15;
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
 * at least one wrap. `meta` carries optional event identity (rumor id + kind)
 * for the detail sheet.
 */
export function aggregateRelayResults(
  settles: RelaySettle[],
  meta?: { eventId?: string; kind?: number },
  // Number of relays the send attempted (the full target set). Carried onto the
  // status as `targetRelayCount` so the early snapshot reports the true total
  // even though only the fast relays have settled (#857). Omit for callers that
  // don't track a target (pure folds in tests) — `total` then derives from the
  // settled relays as before.
  targetRelayCount?: number,
): DeliveryStatus {
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
  return { delivered, relayResults, eventId: meta?.eventId, kind: meta?.kind, targetRelayCount };
}

/** Count of relays that accepted, and the total relays attempted. Drives the
 * breakdown copy ("Sent to 4 of 6 relays") and the single→double tick. `total`
 * is the attempted relay count (`targetRelayCount`) when known, so an early
 * snapshot with only the fast relay settled reads as "1 of N" (single tick) —
 * NOT "1 of 1" (premature double). Falls back to the settled-relay count for
 * legacy rows that predate `targetRelayCount`. Guards against a stale target
 * undercounting by never reporting fewer relays than have actually settled. */
export function summariseDelivery(status: DeliveryStatus): { ok: number; total: number } {
  const values = Object.values(status.relayResults);
  const settledTotal = values.length;
  const total =
    status.targetRelayCount !== undefined
      ? Math.max(status.targetRelayCount, settledTotal)
      : settledTotal;
  return { ok: values.filter((r) => r === 'ok').length, total };
}

/** Strip the `wss://` / `ws://` scheme and trailing slash for a compact relay
 * label in the breakdown sheet. */
export function shortRelayLabel(url: string): string {
  return url.replace(/^wss?:\/\//, '').replace(/\/$/, '');
}
