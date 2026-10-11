// NIP-10 reply detection for kind-1 notes — tells top-level posts apart from
// replies on a profile's Posts tab (#1332). Pure, no I/O.
//
// Rules:
//   - Marked `e` tags (`["e", id, relay, marker, pubkey?]`): `reply` or
//     `root` makes the note a reply; `mention` does not.
//   - Legacy positional `e` tags (no marker): any `e` tag means reply — the
//     first is the root, the last the direct parent.
//   - A `q` tag (NIP-18 quote) or a `nostr:note…` / `nevent…` in the content
//     is a quote / mention, never a reply on its own.
import * as nip19 from 'nostr-tools/nip19';
import { isPublicRelayUrl } from './nip27';
import type { EmbedRef } from '../services/nostrEmbedCache';

export interface ReplySource {
  kind: number;
  pubkey: string;
  tags: string[][];
}

const HEX64 = /^[0-9a-f]{64}$/;

type ETag = { id: string; relay?: string; marker?: string; pubkey?: string };

function eTags(tags: readonly string[][]): ETag[] {
  if (!Array.isArray(tags)) return [];
  const out: ETag[] = [];
  for (const t of tags) {
    if (!Array.isArray(t) || t[0] !== 'e' || typeof t[1] !== 'string') continue;
    const id = t[1].toLowerCase();
    if (!HEX64.test(id)) continue;
    const marker = typeof t[3] === 'string' && t[3] !== '' ? t[3].toLowerCase() : undefined;
    const pubkey =
      typeof t[4] === 'string' && HEX64.test(t[4].toLowerCase()) ? t[4].toLowerCase() : undefined;
    const relay = typeof t[2] === 'string' && isPublicRelayUrl(t[2]) ? t[2] : undefined;
    out.push({ id, relay, marker, pubkey });
  }
  return out;
}

/** The `e` tag naming the note this one directly replies to, or null. */
function parentTag(event: ReplySource): ETag | null {
  if (event.kind !== 1) return null;
  const tags = eTags(event.tags);
  if (tags.length === 0) return null;
  const marked = tags.filter((t) => t.marker !== undefined);
  if (marked.length > 0) {
    // NIP-10 marked: `reply` is the direct parent; a lone `root` means a
    // direct reply to the thread root. `mention` (or unknown) markers don't
    // make a reply.
    return (
      marked.find((t) => t.marker === 'reply') ?? marked.find((t) => t.marker === 'root') ?? null
    );
  }
  // Deprecated positional scheme: the last `e` is the parent.
  return tags[tags.length - 1];
}

export function isReply(event: ReplySource): boolean {
  return parentTag(event) !== null;
}

export interface ReplyTarget {
  /** Embed reference for the parent note (for the compact preview card). */
  ref: Extract<EmbedRef, { type: 'event' }>;
  /**
   * The replied-to author when the tags say so: the parent `e` tag's pubkey
   * (NIP-10), else the first `p` tag that isn't the reply's own author. The
   * fetched parent's `pubkey` is authoritative once it loads.
   */
  authorPubkey: string | null;
}

export function replyTarget(event: ReplySource): ReplyTarget | null {
  const parent = parentTag(event);
  if (!parent) return null;
  const self = event.pubkey.toLowerCase();
  const fromP =
    event.tags
      .filter((t) => Array.isArray(t) && t[0] === 'p' && typeof t[1] === 'string')
      .map((t) => t[1].toLowerCase())
      .find((pk) => HEX64.test(pk) && pk !== self) ?? null;
  const authorPubkey = parent.pubkey ?? fromP;
  const relays = parent.relay ? [parent.relay] : [];
  let raw: string;
  try {
    raw = `nostr:${nip19.neventEncode({ id: parent.id, relays, author: authorPubkey ?? undefined })}`;
  } catch {
    raw = `nostr:${nip19.noteEncode(parent.id)}`;
  }
  return {
    ref: { type: 'event', id: parent.id, relays, author: authorPubkey ?? undefined, kind: 1, raw },
    authorPubkey,
  };
}
