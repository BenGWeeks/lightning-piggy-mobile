// NIP-22 comment (kind 1111) parsing, for the comments some clients (Ditto)
// post as replies to ordinary kind-1 notes (#1337). Read side only: we keep
// replying to kind-1 notes with kind 1 (NIP-10). Pure, no I/O.
//
// NIP-22 scopes a comment with two pointers:
//   - root (UPPERCASE): `E` event id / `A` address / `I` external id, `K` the
//     root's kind, `P` the root's author;
//   - parent (lowercase): `e` / `a` / `i`, `k` the parent's kind, `p` the
//     parent's author. A top-level comment's parent is the root itself.
// `E` / `e` tags carry the author at index 3: `["e", id, relay, pubkey]`
// (NIP-10's kind-1 `e` tags put a marker there instead).
//
// Kind 1111 is also used for Market product comments (`A` root, kind 30402)
// and Piglet comments; those are handled elsewhere and are never note replies.
import * as nip19 from 'nostr-tools/nip19';
import { isPublicRelayUrl } from './nip27';
import type { ReplySource, ReplyTarget } from './nip10';

export const COMMENT_KIND = 1111;
const NOTE_KIND = 1;

const HEX64 = /^[0-9a-f]{64}$/;

export type CommentPointer =
  | { type: 'event'; id: string; relay?: string; pubkey?: string }
  | { type: 'address'; coordinate: string; relay?: string }
  | { type: 'external'; value: string };

export interface CommentScopeSide {
  pointer: CommentPointer | null;
  /**
   * `K` / `k` as a number; null when the tag is absent, NaN when it's there
   * but not a kind number (e.g. `web` for an external root).
   */
  kind: number | null;
  /** `P` / `p` (lowercase hex), or null. */
  author: string | null;
}

export interface CommentScope {
  root: CommentScopeSide;
  parent: CommentScopeSide;
}

const hex = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const v = value.toLowerCase();
  return HEX64.test(v) ? v : null;
};

const relayOf = (value: unknown): string | undefined =>
  typeof value === 'string' && isPublicRelayUrl(value) ? value : undefined;

const firstTag = (tags: readonly string[][], name: string): string[] | undefined =>
  tags.find((t) => Array.isArray(t) && t[0] === name && typeof t[1] === 'string');

function side(tags: readonly string[][], upper: boolean): CommentScopeSide {
  const n = (letter: string) => (upper ? letter.toUpperCase() : letter);
  // An addressable root may carry both `A` and `E` (the exact version); the
  // address is what identifies it.
  let pointer: CommentPointer | null = null;
  const a = firstTag(tags, n('a'));
  const e = firstTag(tags, n('e'));
  const i = firstTag(tags, n('i'));
  if (a && a[1] !== '') {
    pointer = { type: 'address', coordinate: a[1], relay: relayOf(a[2]) };
  } else if (e && hex(e[1])) {
    pointer = {
      type: 'event',
      id: hex(e[1])!,
      relay: relayOf(e[2]),
      pubkey: hex(e[3]) ?? undefined,
    };
  } else if (i && i[1] !== '') {
    pointer = { type: 'external', value: i[1] };
  }
  const k = firstTag(tags, n('k'))?.[1];
  const kind = k === undefined ? null : /^\d+$/.test(k) ? Number(k) : NaN;
  const author = hex(firstTag(tags, n('p'))?.[1]);
  return { pointer, kind, author };
}

/** Root and parent pointers of a kind-1111 comment (null pointers when absent). */
export function parseCommentScope(event: { tags: string[][] }): CommentScope {
  const tags = Array.isArray(event.tags) ? event.tags : [];
  return { root: side(tags, true), parent: side(tags, false) };
}

type EventSide = CommentScopeSide & { pointer: Extract<CommentPointer, { type: 'event' }> };
const isEventSide = (s: CommentScopeSide): s is EventSide => s.pointer?.type === 'event';

/**
 * The root of a comment that replies inside a kind-1 note's thread, or null.
 *
 * Conservative about the root kind, so product / Piglet comments never leak
 * into note views:
 *   - `K` other than `1` (or not a kind number), or an `A` / `I` root:
 *     never a note reply.
 *   - `K` = `1` with an `E` root: a note reply.
 *   - `K` missing (or `K` = `1` without `E`): accepted only for a top-level
 *     comment on a note — an `e` parent with `k` = `1` that IS the root (no
 *     `E`, or the same id). A different `E` root's kind can't be inferred.
 *   - neither `K` nor `k`: not a note reply.
 */
function noteThread(scope: CommentScope): { root: EventSide; parent: EventSide } | null {
  const { root, parent } = scope;
  if (root.kind !== null && root.kind !== NOTE_KIND) return null;
  // An `A` / `I` root is never a note.
  if (root.pointer && root.pointer.type !== 'event') return null;
  if (root.kind === NOTE_KIND && isEventSide(root)) {
    return { root, parent: isEventSide(parent) ? parent : root };
  }
  // No `K`, or `K` = 1 without an `E`: only a kind-1 `e` parent that is
  // itself the root.
  if (parent.kind !== NOTE_KIND || !isEventSide(parent)) return null;
  if (isEventSide(root) && root.pointer.id !== parent.pointer.id) return null;
  return { root: isEventSide(root) ? root : parent, parent };
}

/** True for a kind-1111 comment inside a kind-1 note's thread. */
export function isNoteComment(event: ReplySource): boolean {
  return event.kind === COMMENT_KIND && noteThread(parseCommentScope(event)) !== null;
}

/** The note thread's root id for a note comment, or null. */
export function noteCommentRootId(event: ReplySource): string | null {
  if (event.kind !== COMMENT_KIND) return null;
  return noteThread(parseCommentScope(event))?.root.pointer.id ?? null;
}

/**
 * What a note comment replies to, in the same shape as NIP-10's
 * `replyTarget`, so the profile's "Replying to @Name" line and parent preview
 * work unchanged. The parent is the direct parent (`e`), which may be the
 * root note, a kind-1 reply in the thread, or another comment.
 */
export function noteCommentTarget(event: ReplySource): ReplyTarget | null {
  if (event.kind !== COMMENT_KIND) return null;
  const thread = noteThread(parseCommentScope(event));
  if (!thread) return null;
  const { root, parent } = thread;
  const sameAsRoot = parent.pointer.id === root.pointer.id;
  // `e`'s pubkey and `p` both name the parent's author; the fetched parent's
  // `pubkey` is authoritative once it loads.
  const authorPubkey =
    parent.pointer.pubkey ?? parent.author ?? (sameAsRoot ? root.author : null) ?? null;
  const id = parent.pointer.id;
  const kind =
    parent.kind !== null && Number.isFinite(parent.kind)
      ? parent.kind
      : sameAsRoot
        ? NOTE_KIND
        : undefined;
  const relays = parent.pointer.relay ? [parent.pointer.relay] : [];
  let raw: string;
  try {
    raw = `nostr:${nip19.neventEncode({ id, relays, author: authorPubkey ?? undefined, kind })}`;
  } catch {
    raw = `nostr:${nip19.noteEncode(id)}`;
  }
  return {
    ref: { type: 'event', id, relays, author: authorPubkey ?? undefined, kind, raw },
    authorPubkey,
  };
}
