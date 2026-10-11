// Editing and deleting your own NIP-22 comments (#1272). Pure — no React, no
// I/O — so the publish shapes and the read-side reconciliation are unit-tested
// in isolation.
//
// Comments (kind 1111) are regular events: relays keep every version, and
// NIP-22 has no edit. So:
//  - Delete = a NIP-09 kind-5 request naming the comment by `e` id (+ `k`).
//    Never an `a` tag: the only coordinate on a comment is the PRODUCT's, and
//    an `a`-tagged kind-5 asks relays to delete that address — the listing.
//  - Edit = a NEW kind-1111 comment carrying the original's NIP-22 tags plus
//    `["edit", <old id>]`, followed by a kind-5 for the old one. Any client
//    sees an ordinary comment (relays that honour NIP-09 drop the old one);
//    ours also hides the old version straight from the `edit` tag, so a
//    reader never shows both even when the kind-5 is slow or ignored.
//  - Only the AUTHOR's deletion or edit counts: someone else's kind-5 or
//    `edit` tag pointing at your comment changes nothing.
import type { Event as NostrEvent } from 'nostr-tools';
import { COMMENT_KIND, getTagValue } from './productComments';
import { DELETION_KIND, deletedByAuthor } from './nip09';

/** Tag on a replacement comment naming the comment it replaces. */
export const COMMENT_EDIT_TAG = 'edit';

export interface UnsignedTemplate {
  kind: number;
  tags: string[][];
  content: string;
}

/** The id of the comment `comment` replaces, if it is an edit. */
export function editedFrom(comment: NostrEvent): string | undefined {
  return getTagValue(comment, COMMENT_EDIT_TAG);
}

/** Whether `comment` is an edited version (shown with an "Edited" marker). */
export function isEditedComment(comment: NostrEvent): boolean {
  return !!editedFrom(comment);
}

/**
 * The NIP-09 kind-5 request deleting `comment`. Also names the version it
 * replaced (if any), so deleting an edited comment can't resurface the
 * original on a relay that missed the edit's own kind-5.
 */
export function buildCommentDeletion(comment: NostrEvent): UnsignedTemplate {
  const tags: string[][] = [['e', comment.id]];
  const previous = editedFrom(comment);
  if (previous && previous !== comment.id) tags.push(['e', previous]);
  tags.push(['k', String(comment.kind)]);
  return { kind: DELETION_KIND, content: '', tags };
}

/**
 * The replacement comment for an edit of `original`, or null when there is
 * nothing to publish (empty, or unchanged text). Keeps the original's NIP-22
 * root/parent tags so it lands in the same place in the thread.
 */
export function buildCommentEdit(original: NostrEvent, content: string): UnsignedTemplate | null {
  const text = content.trim();
  if (text === '' || text === original.content.trim()) return null;
  return {
    kind: COMMENT_KIND,
    content: text,
    tags: [
      ...original.tags.filter(([name]) => name !== COMMENT_EDIT_TAG),
      [COMMENT_EDIT_TAG, original.id],
    ],
  };
}

/**
 * The comments a reader should show: de-duplicated by id, minus those the
 * author deleted (kind 5), those the author replaced with an edit, and those
 * hidden locally (an action still in flight).
 */
export function reconcileComments(
  comments: NostrEvent[],
  deletions: NostrEvent[],
  locallyHidden: ReadonlySet<string> = new Set(),
): NostrEvent[] {
  const byId = new Map<string, NostrEvent>();
  for (const c of comments) if (!byId.has(c.id)) byId.set(c.id, c);
  const unique = Array.from(byId.values());

  const hidden = deletedByAuthor(unique, deletions);
  for (const c of unique) {
    const previous = editedFrom(c);
    if (previous && previous !== c.id && byId.get(previous)?.pubkey === c.pubkey) {
      hidden.add(previous);
    }
  }
  return unique.filter((c) => !hidden.has(c.id) && !locallyHidden.has(c.id));
}
