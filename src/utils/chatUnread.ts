// Read position + unread maths for chat threads (#1295). Pure, so the
// screen hooks and the Messages-list badge share one tested rule set.
//
// A conversation's read position is the newest message the viewer has seen:
// its `createdAt` (unix seconds) and, when known, its id. Everything after it
// that someone else sent is unread. Entries are always oldest-first here —
// the inverted 1:1 list reverses its newest-first items before calling in.

export interface ReadMarker {
  /** `createdAt` (unix seconds) of the newest message seen. */
  at: number;
  /** Its id, which places the marker exactly among same-second messages. */
  id?: string;
}

export interface UnreadEntry {
  id: string;
  createdAt: number;
  fromMe: boolean;
  /** This message mentions the viewer (groups). */
  mentionsMe?: boolean;
}

/**
 * Index of the marker's message in `entries`, or -1. Positional matching
 * handles several messages in the same second; when the marked message is
 * gone (deleted, or past the history cap) callers fall back to `at`.
 */
function markerIndex(entries: readonly UnreadEntry[], marker: ReadMarker): number {
  if (!marker.id) return -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].id === marker.id) return i;
  }
  return -1;
}

/** `isUnread(entry, index)` for one marker — computed once per pass. */
function unreadTest(
  entries: readonly UnreadEntry[],
  marker: ReadMarker | null,
): (entry: UnreadEntry, index: number) => boolean {
  if (!marker) return () => false;
  const idx = markerIndex(entries, marker);
  return idx >= 0 ? (e, i) => !e.fromMe && i > idx : (e) => !e.fromMe && e.createdAt > marker.at;
}

/** Id of the oldest unread message, or null when everything is read. */
export function firstUnreadId(
  entries: readonly UnreadEntry[],
  marker: ReadMarker | null,
): string | null {
  const isUnread = unreadTest(entries, marker);
  for (let i = 0; i < entries.length; i++) {
    if (isUnread(entries[i], i)) return entries[i].id;
  }
  return null;
}

/** How many messages from others are newer than the marker. */
export function unreadCount(entries: readonly UnreadEntry[], marker: ReadMarker | null): number {
  const isUnread = unreadTest(entries, marker);
  let n = 0;
  for (let i = 0; i < entries.length; i++) if (isUnread(entries[i], i)) n++;
  return n;
}

/** Ids of unread messages that mention the viewer, oldest first. */
export function unreadMentionIds(
  entries: readonly UnreadEntry[],
  marker: ReadMarker | null,
): string[] {
  const isUnread = unreadTest(entries, marker);
  const out: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].mentionsMe && isUnread(entries[i], i)) out.push(entries[i].id);
  }
  return out;
}

/** Position of a message in the oldest-first thread, when known. */
export type ThreadOrder = (id: string) => number | undefined;

/**
 * Move a read position forward, never back. A later `at` wins. Within the same
 * second the thread order decides (`order`, oldest-first index); without it,
 * or when the old marked message is no longer in the thread, the newer report
 * wins.
 */
export function advanceReadMarker(
  prev: ReadMarker | null,
  next: ReadMarker,
  order?: ThreadOrder,
): ReadMarker {
  if (!prev || next.at > prev.at) return next;
  if (next.at < prev.at || !next.id || next.id === prev.id) return prev;
  const from = prev.id ? order?.(prev.id) : undefined;
  const to = order?.(next.id);
  if (from !== undefined && to !== undefined) return to > from ? next : prev;
  return next;
}

/**
 * The newest of the given (visible) entries as a marker, or null. Same-second
 * ties go by thread order when `order` is given (an inverted list reports its
 * rows newest-first), else to the later one in the list.
 */
export function newestEntryMarker(
  entries: readonly UnreadEntry[],
  order?: ThreadOrder,
): ReadMarker | null {
  let best: UnreadEntry | null = null;
  for (const e of entries) {
    if (!best || e.createdAt > best.createdAt) {
      best = e;
    } else if (e.createdAt === best.createdAt) {
      const a = order?.(best.id);
      const b = order?.(e.id);
      if (a === undefined || b === undefined ? true : b > a) best = e;
    }
  }
  return best ? { at: best.createdAt, id: best.id } : null;
}

/** Whether a mention at `mentionAt` (Messages-list rollup) is still unread. */
export function hasUnreadMention(
  mentionAt: number | undefined,
  marker: ReadMarker | null,
): boolean {
  return mentionAt !== undefined && !!marker && mentionAt > marker.at;
}

/**
 * `createdAt` of the newest message from someone else that mentions the
 * viewer — the Messages-list `@` badge compares it with the read position.
 * Walks back from the newest message and stops at the first hit.
 */
export function latestMentionAt<M extends { senderPubkey: string; createdAt: number }>(
  messages: readonly M[],
  viewer: string | null | undefined,
  mentions: (message: M) => boolean,
): number | undefined {
  if (!viewer) return undefined;
  const me = viewer.toLowerCase();
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.senderPubkey.toLowerCase() === me) continue;
    if (mentions(m)) return m.createdAt;
  }
  return undefined;
}
