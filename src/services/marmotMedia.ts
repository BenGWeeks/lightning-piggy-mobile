// Marmot encrypted media (MIP-04) — the photo format White Noise and other
// Marmot clients send and render: a kind-9 chat event carrying an `imeta`
// tag, with the ChaCha20-Poly1305 ciphertext on Blossom. Current groups use
// `encrypted-media-v2` (White Noise requires it); v1 is still read.
// The file key is derived from the MLS group's epoch secret, so it only
// exists while the group state does: we derive it on send / on receipt and
// fold it into the stored message text (encodeMarmotMediaUrl), leaving the
// renderer free of any group state.

import {
  BLOSSOM_LOCATOR_KIND,
  blossomContentHashFromUrl,
  canonicalizeMimeType,
  decryptMediaFileWithKeys,
  deriveMediaEncryptionKey,
  encodeMediaImetaTag,
  encryptMediaFile,
  getMediaAttachments,
  isSafeBlossomFetchUrl,
  resolveMediaFetchUrls,
  type GroupRumorHistory,
  type MarmotGroup,
  type MediaAttachment,
} from '@internet-privacy/marmot-ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import { encodeMarmotMediaUrl } from '../utils/encryptedFileUrl';
import type { MarmotImageParams } from '../utils/messageContent';
import { t } from '../i18n';

type Group = MarmotGroup<GroupRumorHistory>;
type GroupState = Group['state'];
type Ciphersuite = Group['ciphersuite'];
type MediaPolicy = Group['mediaService']['mediaPolicy'];

/** A received attachment's vetted fetch URL + candidate file keys. */
export interface MarmotMediaRef {
  url: string;
  keysHex: string[];
}
/** Per attachment, keyed by its ciphertext sha256. */
export type MarmotMediaKeys = Record<string, MarmotMediaRef>;

/**
 * The URL to fetch an attachment from, or undefined if none is safe. The
 * locator is sender-controlled: only a public-https Blossom URL that commits
 * to the ciphertext hash and that the group's policy allows (MDK's fetch
 * rules) is ever stored — so a peer can't make the app dial a LAN or
 * loopback address just by rendering a bubble.
 */
export function mediaFetchUrl(a: MediaAttachment, policy: MediaPolicy): string | undefined {
  return resolveMediaFetchUrls(a, policy).find(
    (u) => isSafeBlossomFetchUrl(u) && blossomContentHashFromUrl(u) === a.ciphertextSha256,
  );
}

/** The group state(s) a received attachment may have been keyed under:
 * the current epoch first, then every still-retained one (deduped). */
export function candidateMediaStates(group: Group): GroupState[] {
  const current = group.state;
  const states = [current];
  const seen = new Set([current.groupContext.epoch]);
  for (const s of group.session.retainedStates()) {
    if (seen.has(s.groupContext.epoch)) continue;
    seen.add(s.groupContext.epoch);
    states.push(s);
  }
  return states;
}

/** Attachment types the app renders inline: photos and voice notes. */
export const isRenderableMediaType = (mime: string) =>
  mime.startsWith('image/') || mime.startsWith('audio/');

/** All `imeta` attachments of a Marmot chat event (versioned parse: v1 and
 * v2 references; an invalid one is skipped). */
export function allAttachments(tags: string[][]): MediaAttachment[] {
  return getMediaAttachments(tags);
}

/** The attachments of a Marmot chat event we render inline — photos and
 * voice notes (anything else is ignored; see {@link unsupportedAttachmentText}). */
export function renderableAttachments(tags: string[][]): MediaAttachment[] {
  return allAttachments(tags).filter((a) => isRenderableMediaType(a.mediaType));
}

/**
 * Secret-free stand-in text for a chat event whose attachment didn't make it
 * to a photo / voice bubble (an unsupported type like a video or PDF, or a
 * photo / voice note whose keys we couldn't derive) — so the bubble says so
 * rather than being empty. Names the file and type only: never a URL or
 * key. Null if the event carries no attachment.
 */
export function attachmentFallbackText(tags: string[][]): string | null {
  const a = allAttachments(tags)[0];
  if (!a) return null;
  const name = a.filename.replace(/[\r\n]+/g, ' ').slice(0, 80);
  return t(
    isRenderableMediaType(a.mediaType)
      ? 'messageBubble.attachmentUnavailable'
      : 'messageBubble.unsupportedAttachment',
    { name, type: a.mediaType },
  );
}

/**
 * Derive every candidate key for a rumor's renderable attachments. `states` must
 * be captured when the message is processed — retained epochs are pruned
 * later, after which the media can no longer be decrypted.
 */
export async function deriveMediaKeys(
  states: GroupState[],
  ciphersuite: Ciphersuite,
  policy: MediaPolicy,
  tags: string[][],
): Promise<MarmotMediaKeys> {
  const keys: MarmotMediaKeys = {};
  for (const a of renderableAttachments(tags)) {
    const url = mediaFetchUrl(a, policy);
    if (!url) continue;
    const derived = await Promise.all(
      states.map((s) => deriveMediaEncryptionKey(s, ciphersuite, a)),
    );
    keys[a.ciphertextSha256] = { url, keysHex: derived.map(bytesToHex) };
  }
  return keys;
}

/** The stored message text for a Marmot photo or voice note, or null if `tags` carry no
 * image attachment we hold keys for. Only the first attachment renders. */
export function marmotMediaText(
  tags: string[][],
  keys: MarmotMediaKeys | undefined,
): string | null {
  if (!keys) return null;
  for (const a of renderableAttachments(tags)) {
    const ref = keys[a.ciphertextSha256];
    if (!ref?.url || !ref.keysHex?.length) continue;
    return encodeMarmotMediaUrl({
      url: ref.url,
      keysHex: ref.keysHex,
      version: a.version,
      mime: a.mediaType,
      nonceHex: a.nonce,
      filename: a.filename,
      plaintextSha256: a.plaintextSha256,
      ciphertextSha256: a.ciphertextSha256,
    });
  }
  return null;
}

/** Encrypt a photo / voice note for `group` under its current epoch, in the group's
 * media version. */
export async function encryptMarmotMedia(
  group: Group,
  plaintext: Uint8Array,
  mime: string,
  filename: string,
): Promise<{
  encrypted: Uint8Array;
  attachment: MediaAttachment;
  keyHex: string;
  /** The epoch the key is bound to. */
  epoch: bigint;
}> {
  const fields = {
    version: group.mediaService.mediaVersion,
    plaintextSha256: bytesToHex(sha256(plaintext)),
    mediaType: canonicalizeMimeType(mime),
    filename,
  };
  const state = group.state;
  const key = await deriveMediaEncryptionKey(state, group.ciphersuite, fields);
  const { encrypted, attachment } = encryptMediaFile(plaintext, key, fields);
  return { encrypted, attachment, keyHex: bytesToHex(key), epoch: state.groupContext.epoch };
}

/** The kind-9 `imeta` tag for an uploaded attachment. */
export function marmotImetaTag(attachment: MediaAttachment, blobUrl: string): string[] {
  return encodeMediaImetaTag({
    ...attachment,
    locators: [{ kind: BLOSSOM_LOCATOR_KIND, value: blobUrl }],
  });
}

/** Decrypt a fetched Marmot photo or voice note (verifies both hashes and the AEAD tag). */
export function decryptMarmotMedia(
  encrypted: Uint8Array,
  image: { mime: string; nonceHex?: string; marmot: MarmotImageParams },
): Uint8Array {
  const { version, keysHex, filename, plaintextSha256, ciphertextSha256 } = image.marmot;
  return decryptMediaFileWithKeys(encrypted, keysHex.map(hexToBytes), {
    version,
    locators: [],
    ciphertextSha256,
    plaintextSha256,
    nonce: image.nonceHex ?? '',
    mediaType: image.mime,
    filename,
  });
}
