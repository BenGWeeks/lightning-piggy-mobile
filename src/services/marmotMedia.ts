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
  canonicalizeMimeType,
  decryptMediaFileWithKeys,
  deriveMediaEncryptionKey,
  encodeMediaImetaTag,
  encryptMediaFile,
  getMediaAttachments,
  type GroupRumorHistory,
  type MarmotGroup,
  type MediaAttachment,
} from '@internet-privacy/marmot-ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import { encodeMarmotMediaUrl } from '../utils/encryptedFileUrl';
import type { MarmotImageParams } from '../utils/messageContent';

type Group = MarmotGroup<GroupRumorHistory>;
type GroupState = Group['state'];
type Ciphersuite = Group['ciphersuite'];

/** Candidate file keys per attachment, keyed by its ciphertext sha256. */
export type MarmotMediaKeys = Record<string, string[]>;

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

/** The image attachments of a Marmot chat event (non-images are ignored). */
export function imageAttachments(tags: string[][]): MediaAttachment[] {
  // Versioned parse: v1 and v2 references; an invalid one is skipped.
  return getMediaAttachments(tags).filter((a) => a.mediaType.startsWith('image/'));
}

/**
 * Derive every candidate key for a rumor's image attachments. `states` must
 * be captured when the message is processed — retained epochs are pruned
 * later, after which the media can no longer be decrypted.
 */
export async function deriveMediaKeys(
  states: GroupState[],
  ciphersuite: Ciphersuite,
  tags: string[][],
): Promise<MarmotMediaKeys> {
  const keys: MarmotMediaKeys = {};
  for (const a of imageAttachments(tags)) {
    const derived = await Promise.all(
      states.map((s) => deriveMediaEncryptionKey(s, ciphersuite, a)),
    );
    keys[a.ciphertextSha256] = derived.map(bytesToHex);
  }
  return keys;
}

/** The stored message text for a Marmot photo, or null if `tags` carry no
 * image attachment we hold keys for. Only the first image renders. */
export function marmotMediaText(
  tags: string[][],
  keys: MarmotMediaKeys | undefined,
): string | null {
  if (!keys) return null;
  for (const a of imageAttachments(tags)) {
    const keysHex = keys[a.ciphertextSha256];
    const url = a.locators.find((l) => l.kind === BLOSSOM_LOCATOR_KIND)?.value;
    if (!keysHex?.length || !url) continue;
    return encodeMarmotMediaUrl({
      url,
      version: a.version,
      mime: a.mediaType,
      keysHex,
      nonceHex: a.nonce,
      filename: a.filename,
      plaintextSha256: a.plaintextSha256,
      ciphertextSha256: a.ciphertextSha256,
    });
  }
  return null;
}

/** Encrypt a photo for `group` under its current epoch, in the group's
 * media version. */
export async function encryptMarmotMedia(
  group: Group,
  plaintext: Uint8Array,
  mime: string,
  filename: string,
): Promise<{ encrypted: Uint8Array; attachment: MediaAttachment; keyHex: string }> {
  const fields = {
    version: group.mediaService.mediaVersion,
    plaintextSha256: bytesToHex(sha256(plaintext)),
    mediaType: canonicalizeMimeType(mime),
    filename,
  };
  const key = await deriveMediaEncryptionKey(group.state, group.ciphersuite, fields);
  const { encrypted, attachment } = encryptMediaFile(plaintext, key, fields);
  return { encrypted, attachment, keyHex: bytesToHex(key) };
}

/** The kind-9 `imeta` tag for an uploaded attachment. */
export function marmotImetaTag(attachment: MediaAttachment, blobUrl: string): string[] {
  return encodeMediaImetaTag({
    ...attachment,
    locators: [{ kind: BLOSSOM_LOCATOR_KIND, value: blobUrl }],
  });
}

/** Decrypt a fetched Marmot photo (verifies both hashes and the AEAD tag). */
export function decryptMarmotImage(
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
