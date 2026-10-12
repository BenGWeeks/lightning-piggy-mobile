// Replies to kind-1 notes, from both kinds clients use for them (#1337):
// kind-1 replies (NIP-10) and kind-1111 comments (NIP-22, posted by e.g.
// Ditto). One view over both, so callers needn't care which kind a reply is.
// Pure, no I/O.
import type { Filter } from 'nostr-tools';
import { replyTarget, type ReplySource, type ReplyTarget } from './nip10';
import { COMMENT_KIND, isNoteComment, noteCommentRootId, noteCommentTarget } from './nip22';

export interface ReplyEvent extends ReplySource {
  id: string;
  content: string;
}

/** What a note reply answers — kind 1 via NIP-10, kind 1111 via NIP-22. */
export function noteReplyTarget(event: ReplySource): ReplyTarget | null {
  if (event.kind === 1) return replyTarget(event);
  if (event.kind === COMMENT_KIND) return noteCommentTarget(event);
  return null;
}

/** A kind-1 note, or a kind-1111 comment in a kind-1 note's thread. */
export function isNoteOrNoteComment(event: ReplySource): boolean {
  return event.kind === 1 || isNoteComment(event);
}

const echoKey = (event: ReplyEvent): string | null => {
  const parent = noteReplyTarget(event)?.ref.id;
  if (!parent) return null;
  return `${event.pubkey.toLowerCase()}|${parent}|${event.content.trim().replace(/\s+/g, ' ')}`;
};

/**
 * Drops a kind-1111 comment when the same author also posted the same reply
 * (same parent, same text) as kind 1 — some clients / bridges publish both.
 * The kind-1 copy wins; everything else, including order, is untouched.
 */
export function dedupeReplyEchoes<T extends ReplyEvent>(events: readonly T[]): T[] {
  const kind1 = new Set<string>();
  for (const e of events) {
    if (e.kind !== 1) continue;
    const key = echoKey(e);
    if (key) kind1.add(key);
  }
  if (kind1.size === 0) return [...events];
  return events.filter((e) => {
    if (e.kind !== COMMENT_KIND) return true;
    const key = echoKey(e);
    return !key || !kind1.has(key);
  });
}

/**
 * Relay filters for every reply to one kind-1 note: kind-1 replies by `#e`,
 * and kind-1111 comments by root (`#E`) or direct parent (`#e`). Bounded by
 * `limit`, plus `since` when given. For a note view's reply list / count —
 * there's no in-app note view yet (#540).
 */
export function noteReplyFilters(noteId: string, limit: number, since?: number): Filter[] {
  const bound = { limit, ...(since !== undefined ? { since } : {}) };
  return [
    { kinds: [1], '#e': [noteId], ...bound },
    { kinds: [COMMENT_KIND], '#E': [noteId], ...bound },
    { kinds: [COMMENT_KIND], '#e': [noteId], ...bound },
  ];
}

/**
 * Whether an event fetched with `noteReplyFilters` really replies inside the
 * note's thread: a kind-1 that names it in NIP-10 reply / root position, or
 * a note comment whose root or direct parent it is. Relays can ignore tag
 * filters, and kind-1111s from other threads (products, Piglets) never count.
 */
export function isReplyInNoteThread(event: ReplySource, noteId: string): boolean {
  if (event.kind === COMMENT_KIND) {
    if (!isNoteComment(event)) return false;
    return noteCommentRootId(event) === noteId || noteCommentTarget(event)?.ref.id === noteId;
  }
  if (event.kind !== 1) return false;
  return event.tags.some(
    (t) =>
      Array.isArray(t) &&
      t[0] === 'e' &&
      t[1]?.toLowerCase() === noteId &&
      (t[3] === 'reply' || t[3] === 'root' || t[3] === undefined || t[3] === ''),
  );
}
