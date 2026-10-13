// Pure mapping from decrypted Marmot app events to the app's existing
// message stores: 1:1 DM groups → `dm_messages` rows (protocol 'marmot'),
// multi-member groups → the per-group message log. Kept free of React and
// I/O so the shaping is unit-testable.

import { attachmentMetadata, parseFileAttachment } from '../utils/fileAttachment';
import { textForRumor } from '../utils/nip17Unwrap';
import type { DmMessageRow } from './dmDb';
import type { GroupMessage } from './groupMessagesStorageService';
import { marmotReplyParent } from './marmotEdits';
import { isMarmotMessageKind } from './marmotKinds';
import {
  attachmentFallbackText,
  allAttachments,
  marmotMediaText,
  type MarmotMediaKeys,
} from './marmotMedia';
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
 * Stored text + kind for a Marmot app event. A photo or voice note (MIP-04: kind 9
 * with an `imeta` attachment) is stored like a NIP-17 encrypted file — the
 * `#lpe=1` URL, kind 15 — so the image / voice bubble and the redacted previews apply; its
 * file keys come from the session (`mediaKeys`). File captions are preserved.
 */
export function storedMarmotContent(
  rumor: MarmotRumor,
  mediaKeys?: MarmotMediaKeys,
): { text: string; kind: number } {
  if (rumor.kind === MARMOT_CHAT_KIND) {
    const media = marmotMediaText(rumor.tags, mediaKeys);
    if (media) {
      if (parseFileAttachment(media) && rumor.content) {
        return {
          text: `${media}&caption=${encodeURIComponent(rumor.content)}`,
          kind: APP_FILE_KIND,
        };
      }
      return { text: media, kind: APP_FILE_KIND };
    }
    const attachment = allAttachments(rumor.tags)[0];
    if (
      attachment &&
      !attachment.mediaType.startsWith('image/') &&
      !attachment.mediaType.startsWith('audio/')
    ) {
      return {
        text:
          '[FILE]' +
          JSON.stringify({
            url: '',
            mime: attachment.mediaType,
            encrypted: true,
            caption: rumor.content,
            ...attachmentMetadata(rumor.tags, attachment.filename),
          }),
        kind: APP_FILE_KIND,
      };
    }
    const imeta = rumor.tags.find((tag) => tag[0] === 'imeta');
    const mime =
      imeta?.find((field) => field.startsWith('m '))?.slice(2) ?? 'application/octet-stream';
    if (imeta && mime && !mime.startsWith('image/') && !mime.startsWith('audio/')) {
      const url = imeta.find((field) => field.startsWith('url '))?.slice(4) ?? '';
      const encrypted = imeta.some((field) =>
        /^(v|encryption-algorithm|nonce|decryption-key) /.test(field),
      );
      return {
        text:
          '[FILE]' +
          JSON.stringify({
            url,
            mime,
            encrypted,
            plaintextSha256: imeta.find((field) => field.startsWith('x '))?.slice(2),
            caption: rumor.content,
            ...attachmentMetadata([imeta]),
          }),
        kind: APP_FILE_KIND,
      };
    }
    // An attachment we can't show (unsupported type, or no keys): say so
    // instead of an empty bubble. A real caption wins.
    const fallback = !rumor.content.trim() && attachmentFallbackText(rumor.tags);
    if (fallback) return { text: fallback, kind: APP_TEXT_KIND };
  }
  return { text: textForRumor(rumor), kind: storedKindForMarmot(rumor.kind) };
}

// Message / non-message kinds live in the dependency-free marmotKinds.
export { MARMOT_NON_MESSAGE_KINDS, isMarmotMessageKind } from './marmotKinds';

/** The Marmot wire kind for an app rumor kind — inverse of the above. */
export function marmotKindForAppKind(kind: number): number {
  return kind === APP_TEXT_KIND ? MARMOT_CHAT_KIND : kind;
}

export function marmotRumorToDmRow(owner: string, event: MarmotMessageEvent): DmMessageRow | null {
  const peer = event.group.memberPubkeys[0];
  if (!event.group.isDm || !peer) return null; // a DM whose peer hasn't joined yet
  if (!isMarmotMessageKind(event.rumor.kind)) return null;
  const { rumor } = event;
  const me = owner.toLowerCase();
  const fromMe = rumor.pubkey.toLowerCase() === me;
  const stored = storedMarmotContent(rumor, event.mediaKeys);
  const replyTo = marmotReplyParent(rumor);
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
    ...(replyTo ? { replyTo } : {}),
  };
}

/** At most this many `p`-tag mentions are kept per message. */
const MAX_TAG_MENTIONS = 20;

/**
 * Pubkeys a Marmot chat message `p`-tags as mentions (#1295). Older Lightning
 * Piggy builds sent group messages as NIP-17-shaped rumors that `p`-tag the
 * whole roster and carry a `subject` — those tags name the audience, not
 * mentions, so a rumor with a `subject` tag yields none.
 */
export function marmotTagMentions(rumor: MarmotRumor): string[] {
  if (rumor.kind !== MARMOT_CHAT_KIND) return [];
  if (rumor.tags.some((t) => t[0] === 'subject')) return [];
  const out = new Set<string>();
  for (const t of rumor.tags) {
    if (t[0] === 'p' && typeof t[1] === 'string' && /^[0-9a-f]{64}$/i.test(t[1])) {
      out.add(t[1].toLowerCase());
      if (out.size >= MAX_TAG_MENTIONS) break;
    }
  }
  return [...out];
}

export function marmotRumorToGroupMessage(
  rumor: MarmotRumor,
  mediaKeys?: MarmotMediaKeys,
): GroupMessage {
  const replyTo = marmotReplyParent(rumor);
  const mentions = marmotTagMentions(rumor);
  const stored = storedMarmotContent(rumor, mediaKeys);
  return {
    id: rumor.id,
    senderPubkey: rumor.pubkey.toLowerCase(),
    text: stored.text,
    ...(stored.kind !== 14 ? { wireKind: stored.kind } : {}),
    createdAt: rumor.created_at,
    ...(replyTo ? { replyTo } : {}),
    ...(mentions.length > 0 ? { mentions } : {}),
  };
}
