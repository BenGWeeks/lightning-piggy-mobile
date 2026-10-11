import type { Event as NostrEvent } from 'nostr-tools';
import {
  COMMENT_EDIT_TAG,
  buildCommentDeletion,
  buildCommentEdit,
  editedFrom,
  isEditedComment,
  reconcileComments,
} from './commentEdits';
import { COMMENT_KIND } from './productComments';
import { DELETION_KIND } from './nip09';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const COORD = `30402:${'c'.repeat(64)}:product`;
const THREAD_TAGS = [
  ['A', COORD],
  ['K', '30402'],
  ['P', 'c'.repeat(64)],
  ['a', COORD],
  ['k', '30402'],
  ['p', 'c'.repeat(64)],
];

const comment = (id: string, over: Partial<NostrEvent> = {}): NostrEvent =>
  ({
    id,
    pubkey: ME,
    kind: COMMENT_KIND,
    tags: THREAD_TAGS,
    content: `text ${id}`,
    created_at: 100,
    sig: '',
    ...over,
  }) as NostrEvent;

const deletion = (ids: string[], pubkey = ME): NostrEvent =>
  ({
    id: `del-${ids.join('-')}-${pubkey.slice(0, 1)}`,
    pubkey,
    kind: DELETION_KIND,
    tags: ids.map((id) => ['e', id]),
    content: '',
    created_at: 200,
    sig: '',
  }) as NostrEvent;

describe('buildCommentDeletion', () => {
  it('names the comment by e id and kind, never by a coordinate', () => {
    const d = buildCommentDeletion(comment('c1'));
    expect(d).toEqual({
      kind: DELETION_KIND,
      content: '',
      tags: [
        ['e', 'c1'],
        ['k', String(COMMENT_KIND)],
      ],
    });
    // An `a` tag would ask relays to delete the product listing itself.
    expect(d.tags.some(([n]) => n === 'a' || n === 'A')).toBe(false);
  });

  it('also names the version an edited comment replaced', () => {
    const d = buildCommentDeletion(
      comment('c2', { tags: [...THREAD_TAGS, [COMMENT_EDIT_TAG, 'c1']] }),
    );
    expect(d.tags).toEqual([
      ['e', 'c2'],
      ['e', 'c1'],
      ['k', String(COMMENT_KIND)],
    ]);
  });
});

describe('buildCommentEdit', () => {
  it('keeps the thread tags and adds the edit pointer', () => {
    const edit = buildCommentEdit(comment('c1'), '  fixed typo  ');
    expect(edit).toEqual({
      kind: COMMENT_KIND,
      content: 'fixed typo',
      tags: [...THREAD_TAGS, [COMMENT_EDIT_TAG, 'c1']],
    });
  });

  it('points a re-edit at the latest version only', () => {
    const edited = comment('c2', { tags: [...THREAD_TAGS, [COMMENT_EDIT_TAG, 'c1']] });
    const edit = buildCommentEdit(edited, 'again');
    expect(edit?.tags.filter(([n]) => n === COMMENT_EDIT_TAG)).toEqual([[COMMENT_EDIT_TAG, 'c2']]);
  });

  it('returns null for empty or unchanged text', () => {
    expect(buildCommentEdit(comment('c1'), '   ')).toBeNull();
    expect(buildCommentEdit(comment('c1', { content: 'same' }), ' same ')).toBeNull();
  });
});

describe('editedFrom / isEditedComment', () => {
  it('reads the edit pointer', () => {
    const edited = comment('c2', { tags: [...THREAD_TAGS, [COMMENT_EDIT_TAG, 'c1']] });
    expect(editedFrom(edited)).toBe('c1');
    expect(isEditedComment(edited)).toBe(true);
    expect(isEditedComment(comment('c1'))).toBe(false);
  });
});

describe('reconcileComments', () => {
  it('drops author-deleted comments but keeps ones others tried to delete', () => {
    const out = reconcileComments(
      [comment('c1'), comment('c2', { pubkey: OTHER })],
      [deletion(['c1']), deletion(['c2'], ME)],
    );
    expect(out.map((c) => c.id)).toEqual(['c2']);
  });

  it('never shows both the old and the edited version, even without a kind-5', () => {
    const original = comment('c1');
    const edited = comment('c2', {
      content: 'new',
      created_at: 150,
      tags: [...THREAD_TAGS, [COMMENT_EDIT_TAG, 'c1']],
    });
    expect(reconcileComments([original, edited], []).map((c) => c.id)).toEqual(['c2']);
  });

  it('collapses a chain of edits to the latest version', () => {
    const v1 = comment('v1');
    const v2 = comment('v2', { tags: [...THREAD_TAGS, [COMMENT_EDIT_TAG, 'v1']] });
    const v3 = comment('v3', { tags: [...THREAD_TAGS, [COMMENT_EDIT_TAG, 'v2']] });
    expect(reconcileComments([v3, v1, v2], []).map((c) => c.id)).toEqual(['v3']);
  });

  it("ignores an edit tag pointing at someone else's comment", () => {
    const victim = comment('c1', { pubkey: OTHER });
    const spoof = comment('c2', { tags: [...THREAD_TAGS, [COMMENT_EDIT_TAG, 'c1']] });
    expect(reconcileComments([victim, spoof], []).map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('keeps the original hidden when its edit is later deleted', () => {
    const original = comment('c1');
    const edited = comment('c2', { tags: [...THREAD_TAGS, [COMMENT_EDIT_TAG, 'c1']] });
    expect(reconcileComments([original, edited], [deletion(['c2', 'c1'])])).toEqual([]);
  });

  it('applies local hides and de-duplicates by id', () => {
    const c1 = comment('c1');
    const out = reconcileComments([c1, c1, comment('c2')], [], new Set(['c2']));
    expect(out.map((c) => c.id)).toEqual(['c1']);
  });
});
