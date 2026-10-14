// The in-place edit state for your own Market comments (#1524): which comment
// card is currently the editor, and the text it holds. Pure — no React, no
// I/O — so the transitions are unit-tested in isolation; the hook
// (`useProductCommentActions`) just holds the value.
//
// Only ONE comment is ever in edit mode: starting an edit on another comment
// replaces (i.e. cancels) the first.
import type { Event as NostrEvent } from 'nostr-tools';

/** The comment being edited in place and its draft, or null when none is. */
export type CommentEditDraft = { comment: NostrEvent; text: string } | null;

/** Start editing `comment` in place, prefilled with its current text. */
export function beginCommentEdit(comment: NostrEvent): CommentEditDraft {
  return { comment, text: comment.content };
}

/** Update the draft text (no-op when nothing is being edited). */
export function updateCommentEditText(draft: CommentEditDraft, text: string): CommentEditDraft {
  return draft ? { ...draft, text } : draft;
}

/**
 * Leave edit mode, but only if `id` is the comment being edited — a save or
 * delete that finishes after the user moved on to another comment must not
 * close that newer edit.
 */
export function endCommentEditFor(draft: CommentEditDraft, id: string): CommentEditDraft {
  return draft?.comment.id === id ? null : draft;
}

/**
 * Whether `text` is a publishable edit of `original`: not empty, and not the
 * same text (both trimmed — mirrors `buildCommentEdit`, which publishes
 * nothing in those cases).
 */
export function canSaveCommentEdit(original: string, text: string): boolean {
  const next = text.trim();
  return next !== '' && next !== original.trim();
}

/** Short id suffix for the in-card editor's testIDs (`comment-edit-*-<id8>`). */
export function commentIdTestSuffix(id: string): string {
  return id.slice(0, 8);
}
