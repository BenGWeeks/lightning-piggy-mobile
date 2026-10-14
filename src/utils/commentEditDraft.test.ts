import type { Event as NostrEvent } from 'nostr-tools';
import {
  beginCommentEdit,
  canSaveCommentEdit,
  commentIdTestSuffix,
  endCommentEditFor,
  updateCommentEditText,
} from './commentEditDraft';

const comment = (id: string, content: string): NostrEvent => ({
  id,
  pubkey: 'p'.repeat(64),
  created_at: 1,
  kind: 1111,
  tags: [],
  content,
  sig: 's'.repeat(128),
});

describe('commentEditDraft', () => {
  const a = comment('a'.repeat(64), 'Do you delever to the UK?');
  const b = comment('b'.repeat(64), 'Second comment');

  it('starts an edit prefilled with the comment text', () => {
    expect(beginCommentEdit(a)).toEqual({ comment: a, text: 'Do you delever to the UK?' });
  });

  it('updates the draft text, and ignores updates with no edit open', () => {
    const draft = updateCommentEditText(beginCommentEdit(a), 'Do you deliver to the UK?');
    expect(draft).toEqual({ comment: a, text: 'Do you deliver to the UK?' });
    expect(updateCommentEditText(null, 'x')).toBeNull();
  });

  it('starting an edit on another comment replaces the first (one at a time)', () => {
    let draft = updateCommentEditText(beginCommentEdit(a), 'changed');
    draft = beginCommentEdit(b);
    expect(draft).toEqual({ comment: b, text: 'Second comment' });
  });

  it('only ends the edit for the matching comment', () => {
    const draft = beginCommentEdit(b);
    expect(endCommentEditFor(draft, a.id)).toBe(draft);
    expect(endCommentEditFor(draft, b.id)).toBeNull();
    expect(endCommentEditFor(null, a.id)).toBeNull();
  });

  it('can only save a changed, non-empty edit', () => {
    expect(canSaveCommentEdit('hello', 'hello')).toBe(false);
    expect(canSaveCommentEdit('hello', '  hello \n')).toBe(false);
    expect(canSaveCommentEdit('hello', '   ')).toBe(false);
    expect(canSaveCommentEdit('hello', '')).toBe(false);
    expect(canSaveCommentEdit('hello', 'hello there')).toBe(true);
  });

  it('builds the 8-char testID suffix', () => {
    expect(commentIdTestSuffix('0123456789abcdef')).toBe('01234567');
  });
});
