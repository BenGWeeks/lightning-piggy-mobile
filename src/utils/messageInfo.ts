// What the message-info sheet (#856, DeliveryDetailSheet) shows for ONE tapped
// bubble, decided in one pure place so the 1:1 and group screens can't drift
// apart again (#1296: the group screen never said "Marmot", and every Marmot
// message showed NIP-17's "Direct message (kind 14)").
//
// Wire facts the decisions rest on:
// - NIP-04: one kind-4 event, findable on relays by its id.
// - NIP-17: a kind-14 (text) / kind-15 (file) rumor sealed inside kind-1059
//   gift wraps — one wrap per recipient plus a self-copy. Our sent rows carry
//   the rumor id (same for every wrap); received rows are keyed by the wrap
//   id we fetched (`dmWrapIngest`).
// - Marmot: an MLS application message inside a kind-445 group event. Chat
//   is a kind-9 rumor, a photo / voice note is kind 9 + `imeta` (MIP-04). The
//   app STORES them under NIP-17's kinds (14 text, 15 file — marmotInbox's
//   `storedMarmotContent`), so the stored kind must be translated back here.
//   Rows are keyed by the Marmot rumor id (what replies / edits target).

import type { DeliveryStatus, MessageInfo } from './dmDeliveryStatus';
import { protocolForWireKind, type DmProtocol } from './dmProtocol';

/** The app's stored text / file kinds (NIP-17's). */
const TEXT_KIND = 14;
const NIP04_KIND = 4;

export interface MessageInfoInput {
  /** The thread's protocol. 1:1 threads are partitioned by protocol; a group
   * is 'marmot' or 'nip17'. A kind-4 row always reads as NIP-04. */
  protocol: DmProtocol;
  fromMe: boolean;
  /** The bubble's row id (`dm-` prefix stripped by the bubble). */
  rowId: string;
  /** The stored app kind (see the header). */
  wireKind?: number;
  /** Sent 1:1 messages only — groups don't track per-relay delivery. */
  deliveryStatus?: DeliveryStatus;
  /** The bubble's Re-publish payload ('' when it can't be re-sent). */
  resendText: string;
}

/**
 * Builds the sheet's `MessageInfo` plus whether Re-publish is offered.
 *
 * Re-publish re-runs the thread's own send path (`resendText` from the
 * screen's composer hook — Marmot threads/groups send over Marmot, NIP-04
 * threads over NIP-04, NIP-17 over NIP-17), so it's offered only where that
 * path reproduces the message: a SENT text (kind 14, or kind 4 on NIP-04)
 * with a payload. Never for received messages, files (kind 15 would be
 * re-sent as text and lose its file tags) or cards (empty payload).
 */
export function buildMessageInfo(input: MessageInfoInput): {
  info: MessageInfo;
  canResend: boolean;
} {
  const { fromMe, deliveryStatus } = input;
  // A just-sent optimistic row has no stored kind yet; the send result
  // carries the rumor kind (Copilot #858).
  const wireKind = input.wireKind ?? deliveryStatus?.kind;
  // Marmot is explicit (its rumors reuse NIP-17's kinds); otherwise kind 4
  // is NIP-04 and anything else NIP-17.
  const effective: DmProtocol =
    input.protocol === 'marmot' ? 'marmot' : protocolForWireKind(wireKind);

  // A tracked send knows its rumor (Marmot / NIP-17) or event (NIP-04) id.
  const eventId = deliveryStatus?.eventId ?? input.rowId;

  const { resendText } = input;

  const resendableKind = effective === 'nip04' ? NIP04_KIND : TEXT_KIND;
  const canResend = fromMe && !!resendText && wireKind === resendableKind;

  return {
    info: {
      direction: fromMe ? 'sent' : 'received',
      eventId,
      wireKind,
      protocol: effective,
      deliveryStatus,
      resendText,
    },
    canResend,
  };
}
