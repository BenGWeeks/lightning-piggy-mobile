// The Marmot leg of the 1:1 send seam: every DM send function in
// useMessageSend (text, file, poll, wallet share) builds the same rumor it
// would gift-wrap for NIP-17, then — for a Marmot thread — hands it here
// instead. The rumor rides inside the DM's MLS group, so every message type
// the app supports works unchanged.

import { Buffer } from 'buffer';
import type { SendHooks, SendResult } from '../contexts/useMessageSend';
import type { DeliveryStatus } from '../utils/dmDeliveryStatus';
import { encodeMarmotMediaUrl } from '../utils/encryptedFileUrl';
import { uploadEncryptedBlobToBlossom, type BlossomSigner } from './blossomService';
import { marmotKindForAppKind } from './marmotInbox';
import { marmotImetaTag } from './marmotMedia';
import { getBlossomServers } from './walletStorageService';
import {
  MarmotNoKeyPackageError,
  MarmotUnusableKeyPackageError,
  MARMOT_CHAT_KIND,
  buildMarmotRumor,
  getMarmotSession,
  type MarmotSession,
} from './marmotSession';

export interface MarmotDraft {
  kind: number;
  content: string;
  tags?: string[][];
  created_at?: number;
}

/** Turn publish acks into the bubble's delivery tick. */
export function marmotDelivery(
  byRelay: Record<string, boolean>,
  meta: { eventId: string; kind: number },
): DeliveryStatus {
  const relayResults: DeliveryStatus['relayResults'] = {};
  for (const [url, ok] of Object.entries(byRelay)) relayResults[url] = ok ? 'ok' : 'failed';
  return {
    delivered: Object.values(byRelay).some(Boolean),
    relayResults,
    targetRelayCount: Object.keys(byRelay).length,
    ...meta,
  };
}

/** A user-facing reason a Marmot send couldn't start, or null. */
export function marmotSendError(e: unknown): string {
  if (e instanceof MarmotNoKeyPackageError) {
    return "This person hasn't set up Marmot yet — try NIP-17 instead.";
  }
  if (e instanceof MarmotUnusableKeyPackageError) {
    // Seen in the wild: legacy MDK 0.8.x key packages (the classic White
    // Noise app still ships it) that this current-protocol library can't
    // decode, and expired ones. Not the peer's fault — the protocols differ.
    return "This person's Marmot app uses an older version of Marmot that Lightning Piggy can't talk to yet — use NIP-17 for now.";
  }
  return (e as Error)?.message || 'Marmot send failed';
}

/** A failed send's result: the user-facing reason, plus whether the peer
 * simply can't be reached over Marmot (so NIP-17 would still work). */
function marmotFailure(e: unknown): SendResult {
  const marmotUnreachable =
    e instanceof MarmotNoKeyPackageError || e instanceof MarmotUnusableKeyPackageError;
  return {
    success: false,
    error: marmotSendError(e),
    ...(marmotUnreachable ? { marmotUnreachable } : {}),
  };
}

export function requireMarmotSession(pubkey: string): MarmotSession {
  const session = getMarmotSession();
  if (!session || session.pubkey !== pubkey) {
    throw new Error('Marmot is still starting up — try again in a moment.');
  }
  return session;
}

/**
 * Send `draft` to `recipient` over their Marmot DM (created on first use).
 * The rumor is sent as built — same tags and created_at — so content-addressed
 * ids (a NIP-88 poll's id is its rumor id) match what the sender stored. Only
 * text changes kind (14 → Marmot's 9), and text carries no correlation id.
 */
export async function sendMarmotDm(
  pubkey: string,
  recipient: string,
  draft: MarmotDraft,
  hooks?: SendHooks,
): Promise<SendResult> {
  try {
    const session = requireMarmotSession(pubkey);
    const dm = await session.getOrCreateDm(recipient);
    const rumor = buildMarmotRumor(pubkey, {
      kind: marmotKindForAppKind(draft.kind),
      content: draft.content,
      tags: draft.tags,
      created_at: draft.created_at,
    });
    // The app keys bubbles by its own kind (14 = text), not Marmot's 9.
    const meta = { eventId: rumor.id, kind: draft.kind };
    hooks?.onRumorReady?.({ ...meta, relays: dm.relays });
    const delivery = marmotDelivery(await session.sendRumor(dm.id, rumor), meta);
    hooks?.onDeliveryFinalized?.(delivery);
    return delivery.delivered
      ? { success: true, delivery }
      : { success: false, delivery, error: 'No relay accepted the message' };
  } catch (e) {
    return marmotFailure(e);
  }
}

/** Send an app rumor into a Marmot group (multi-member). Same "send the
 * rumor as built" rule as {@link sendMarmotDm}. */
export async function sendMarmotGroupRumor(
  pubkey: string,
  appGroupId: string,
  draft: MarmotDraft,
): Promise<{ success: boolean; wrapsPublished?: number; error?: string }> {
  try {
    const session = requireMarmotSession(pubkey);
    const rumor = buildMarmotRumor(pubkey, {
      kind: marmotKindForAppKind(draft.kind),
      content: draft.content,
      tags: draft.tags,
      created_at: draft.created_at,
    });
    const byRelay = await session.sendRumor(appGroupId, rumor);
    const accepted = Object.values(byRelay).filter(Boolean).length;
    return accepted > 0
      ? { success: true, wrapsPublished: accepted }
      : { success: false, error: 'No relay accepted the message' };
  } catch (e) {
    return { success: false, error: marmotSendError(e) };
  }
}

/** App kind the photo row is stored under (NIP-17's file kind — see marmotInbox). */
const MARMOT_IMAGE_ROW_KIND = 15;

export interface MarmotImage {
  /** Local file uri (names the upload) + its bytes as base64. */
  uri: string;
  base64: string;
  mime: string;
}

/**
 * Send a photo the Marmot way (MIP-04): encrypt it under the group's epoch,
 * upload the ciphertext to Blossom, and send a kind-9 chat event carrying its
 * `imeta` tag — the shape White Noise and other Marmot clients render.
 * `target` is a 1:1 peer (DM created on first use) or an app group id.
 * `onRumorReady` carries the row text (the `#lpe=1` URL) for the optimistic bubble.
 */
export async function sendMarmotImage(
  pubkey: string,
  target: { peer: string } | { groupId: string },
  image: MarmotImage,
  signer: BlossomSigner,
  hooks?: {
    onRumorReady?: (meta: {
      eventId: string;
      kind: number;
      relays: string[];
      text: string;
    }) => void;
    onDeliveryFinalized?: SendHooks['onDeliveryFinalized'];
  },
): Promise<SendResult> {
  try {
    const session = requireMarmotSession(pubkey);
    const group =
      'peer' in target
        ? await session.getOrCreateDm(target.peer)
        : session.getGroup(target.groupId);
    if (!group) throw new Error('This group is not available yet.');
    const plaintext = new Uint8Array(Buffer.from(image.base64, 'base64'));
    const filename = `photo.${image.mime.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'}`;
    const { encrypted, attachment, keyHex } = await session.encryptMedia(
      group.id,
      plaintext,
      image.mime,
      filename,
    );
    // Opaque bytes: the real type travels in the `imeta` tag.
    const url = await uploadEncryptedBlobToBlossom(
      image.uri,
      await getBlossomServers(),
      signer,
      Buffer.from(encrypted).toString('base64'),
    );
    const rumor = buildMarmotRumor(pubkey, {
      kind: MARMOT_CHAT_KIND,
      content: '',
      tags: [marmotImetaTag(attachment, url)],
    });
    const keys = { [attachment.ciphertextSha256]: [keyHex] };
    await session.rememberMediaKeys(group.id, rumor.id, keys);
    const text = encodeMarmotMediaUrl({
      url,
      version: attachment.version,
      mime: attachment.mediaType,
      keysHex: [keyHex],
      nonceHex: attachment.nonce,
      filename,
      plaintextSha256: attachment.plaintextSha256,
      ciphertextSha256: attachment.ciphertextSha256,
    });
    const meta = { eventId: rumor.id, kind: MARMOT_IMAGE_ROW_KIND };
    hooks?.onRumorReady?.({ ...meta, relays: group.relays, text });
    const delivery = marmotDelivery(await session.sendRumor(group.id, rumor), meta);
    hooks?.onDeliveryFinalized?.(delivery);
    return delivery.delivered
      ? { success: true, delivery }
      : { success: false, delivery, error: 'No relay accepted the photo' };
  } catch (e) {
    return marmotFailure(e);
  }
}
