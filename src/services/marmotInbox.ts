// Pure mapping from decrypted Marmot app events to the app's existing
// message stores: 1:1 DM groups → `dm_messages` rows (protocol 'marmot'),
// multi-member groups → the per-group message log. Kept free of React and
// I/O so the shaping is unit-testable.

import { textForRumor } from '../utils/nip17Unwrap';
import type { DmMessageRow } from './dmDb';
import type { GroupMessage } from './groupMessagesStorageService';
import { marmotMediaText, type MarmotMediaKeys } from './marmotMedia';
import { MARMOT_CHAT_KIND, type MarmotMessageEvent, type MarmotRumor } from './marmotSession';

/** NIP-17's chat kind — the app's text pipeline (renderer, message-info,
 * previews) keys on it. */
const APP_TEXT_KIND = 14;
/** NIP-17's file kind — the app's attachment pipeline (previews redact it). */
const APP_FILE_KIND = 15;

/**
 * The wire kind a Marmot app event is stored under. Marmot chat is kind 9;
 * it's stored as the app's text kind (14) because the `protocol` column, not
 * the kind, now identifies the transport. Every other kind (15 files, 1068
 * polls, 16/17 orders, …) is the same rumor shape NIP-17 carries, so it keeps
 * its kind and the existing renderers apply unchanged.
 */
export function storedKindForMarmot(kind: number): number {
  return kind === MARMOT_CHAT_KIND ? APP_TEXT_KIND : kind;
}

/**
 * Stored text + kind for a Marmot app event. A photo (MIP-04: kind 9 with an
 * `imeta` attachment) is stored like a NIP-17 encrypted file — the `#lpe=1`
 * URL, kind 15 — so the image bubble and the redacted previews apply; its
 * file keys come from the session (`mediaKeys`). A caption is dropped.
 */
export function storedMarmotContent(
  rumor: MarmotRumor,
  mediaKeys?: MarmotMediaKeys,
): { text: string; kind: number } {
  if (rumor.kind === MARMOT_CHAT_KIND) {
    const media = marmotMediaText(rumor.tags, mediaKeys);
    if (media) return { text: media, kind: APP_FILE_KIND };
  }
  return { text: textForRumor(rumor), kind: storedKindForMarmot(rumor.kind) };
}

/** The Marmot wire kind for an app rumor kind — inverse of the above. */
export function marmotKindForAppKind(kind: number): number {
  return kind === APP_TEXT_KIND ? MARMOT_CHAT_KIND : kind;
}

export function marmotRumorToDmRow(owner: string, event: MarmotMessageEvent): DmMessageRow | null {
  const peer = event.group.memberPubkeys[0];
  if (!event.group.isDm || !peer) return null; // a DM whose peer hasn't joined yet
  const { rumor } = event;
  const me = owner.toLowerCase();
  const fromMe = rumor.pubkey.toLowerCase() === me;
  const stored = storedMarmotContent(rumor, event.mediaKeys);
  return {
    owner,
    // The Marmot app-event id is stable across every member's copy.
    eventId: rumor.id,
    conversation: peer,
    createdAt: rumor.created_at,
    sender: fromMe ? me : peer,
    content: stored.text,
    fromMe,
    wireKind: stored.kind,
    // Reaction / per-message zap target for both directions (#205), and the
    // delivery-store key for our own rows (#857) — same as NIP-17.
    rumorId: rumor.id,
    protocol: 'marmot',
  };
}

export function marmotRumorToGroupMessage(
  rumor: MarmotRumor,
  mediaKeys?: MarmotMediaKeys,
): GroupMessage {
  return {
    id: rumor.id,
    senderPubkey: rumor.pubkey.toLowerCase(),
    text: storedMarmotContent(rumor, mediaKeys).text,
    createdAt: rumor.created_at,
  };
}
