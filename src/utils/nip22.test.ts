import * as nip19 from 'nostr-tools/nip19';
import { isNoteComment, noteCommentRootId, noteCommentTarget, parseCommentScope } from './nip22';

const BEN = '971615b70ad9ec896f8d5ba0f2d01652f1dfe5f9ced81ac9469ca7facefad68b';
const DEREK = '3f770d65d3a764a9c5cb503ae123e62ec7598ad035d836e2a810f3877a745b24';
const NOTE = '77f88939b4c886babb1007d67c687b02c32577e72277eff34b369fbf4e432636';
const THREAD_REPLY = '08a21e7fdea6549c8fe3d53ebbcbb66c8b08660c0bf99d9b78e94ffbdf929ec9';
const DITTO = ['client', 'Ditto', '31990:781a…:ditto'];

const comment = (tags: string[][], pubkey = DEREK) => ({ kind: 1111, pubkey, tags });

// Derek Ross's real Ditto reply (bd757985…) to Ben's note: a top-level
// comment, so the parent is the root.
const derekTopLevel = comment([
  ['E', NOTE, '', BEN],
  ['K', '1'],
  ['P', BEN],
  ['e', NOTE, '', BEN],
  ['k', '1'],
  ['p', BEN],
  DITTO,
]);
// His second one (3d75feff…): same thread, answering a kind-1 reply in it.
const derekNested = comment([
  ['E', NOTE, '', BEN],
  ['K', '1'],
  ['P', BEN],
  ['e', THREAD_REPLY, '', BEN],
  ['k', '1'],
  ['p', BEN, 'wss://relay.damus.io/'],
  DITTO,
]);

describe('parseCommentScope', () => {
  it('reads the uppercase root and lowercase parent', () => {
    const scope = parseCommentScope(derekNested);
    expect(scope.root).toEqual({
      pointer: { type: 'event', id: NOTE, relay: undefined, pubkey: BEN },
      kind: 1,
      author: BEN,
    });
    expect(scope.parent.pointer).toMatchObject({ type: 'event', id: THREAD_REPLY, pubkey: BEN });
    expect(scope.parent.kind).toBe(1);
  });

  it('prefers an A address over E for an addressable root', () => {
    const scope = parseCommentScope({
      tags: [
        ['A', `30402:${BEN}:sock`, 'wss://relay.example.com'],
        ['E', NOTE],
        ['K', '30402'],
      ],
    });
    expect(scope.root.pointer).toEqual({
      type: 'address',
      coordinate: `30402:${BEN}:sock`,
      relay: 'wss://relay.example.com',
    });
    expect(scope.root.kind).toBe(30402);
  });

  it('reads an I external root, and tolerates junk tags', () => {
    const scope = parseCommentScope({
      tags: [['I', 'https://example.com/a'], ['K', 'web'], ['e', 'not-hex'], 'x' as never],
    });
    expect(scope.root.pointer).toEqual({ type: 'external', value: 'https://example.com/a' });
    expect(scope.root.kind).toBeNull();
    expect(scope.parent.pointer).toBeNull();
  });

  it('drops non-public relay hints', () => {
    const scope = parseCommentScope({ tags: [['E', NOTE, 'ws://localhost:7777']] });
    expect(scope.root.pointer).toMatchObject({ relay: undefined });
  });
});

describe('isNoteComment', () => {
  it('accepts comments in a kind-1 thread (K = 1)', () => {
    expect(isNoteComment(derekTopLevel)).toBe(true);
    expect(isNoteComment(derekNested)).toBe(true);
    expect(noteCommentRootId(derekNested)).toBe(NOTE);
  });

  it('accepts uppercase-only tags', () => {
    expect(
      isNoteComment(
        comment([
          ['E', NOTE],
          ['K', '1'],
        ]),
      ),
    ).toBe(true);
  });

  it('rejects Market product and Piglet comments', () => {
    const product = comment([
      ['A', `30402:${BEN}:sock`],
      ['K', '30402'],
      ['a', `30402:${BEN}:sock`],
      ['k', '30402'],
    ]);
    const piglet = comment([
      ['A', `37516:${BEN}:cache`],
      ['K', '37516'],
      ['e', NOTE],
      ['k', '1'],
    ]);
    expect(isNoteComment(product)).toBe(false);
    expect(isNoteComment(piglet)).toBe(false);
  });

  it('rejects a K other than 1 even when the parent is a kind-1', () => {
    expect(
      isNoteComment(
        comment([
          ['E', NOTE],
          ['K', '30023'],
          ['e', NOTE],
          ['k', '1'],
        ]),
      ),
    ).toBe(false);
  });

  it('missing K: accepts only an e parent with k = 1', () => {
    expect(
      isNoteComment(
        comment([
          ['E', NOTE],
          ['e', NOTE],
          ['k', '1'],
        ]),
      ),
    ).toBe(true);
    // Lowercase only (non-conforming, but unambiguous): the parent is the root.
    expect(
      noteCommentRootId(
        comment([
          ['e', NOTE],
          ['k', '1'],
        ]),
      ),
    ).toBe(NOTE);
    expect(
      isNoteComment(
        comment([
          ['E', NOTE],
          ['e', NOTE],
        ]),
      ),
    ).toBe(false);
    expect(isNoteComment(comment([['E', NOTE]]))).toBe(false);
    expect(
      isNoteComment(
        comment([
          ['e', NOTE],
          ['k', '1111'],
        ]),
      ),
    ).toBe(false);
    // An A root without K is never a note.
    expect(
      isNoteComment(
        comment([
          ['A', `30402:${BEN}:x`],
          ['e', NOTE],
          ['k', '1'],
        ]),
      ),
    ).toBe(false);
  });

  it('rejects a K = 1 root that is not an event pointer, and non-1111 kinds', () => {
    expect(
      isNoteComment(
        comment([
          ['I', 'https://x.example'],
          ['K', '1'],
        ]),
      ),
    ).toBe(false);
    expect(isNoteComment({ ...derekTopLevel, kind: 1 })).toBe(false);
  });
});

describe('noteCommentTarget', () => {
  it('points a top-level comment at the root note, author from the tags', () => {
    const target = noteCommentTarget(derekTopLevel)!;
    expect(target.authorPubkey).toBe(BEN);
    expect(target.ref).toMatchObject({ type: 'event', id: NOTE, author: BEN, kind: 1 });
    const decoded = nip19.decode(target.ref.raw.replace(/^nostr:/, ''));
    expect(decoded.type).toBe('nevent');
    expect(decoded.data).toMatchObject({ id: NOTE, author: BEN, kind: 1 });
  });

  it('points a nested comment at its direct parent', () => {
    expect(noteCommentTarget(derekNested)?.ref.id).toBe(THREAD_REPLY);
  });

  it('falls back to p, then (for a top-level comment) P, for the author', () => {
    const fromP = noteCommentTarget(
      comment([
        ['E', NOTE],
        ['K', '1'],
        ['e', THREAD_REPLY],
        ['k', '1111'],
        ['p', BEN],
      ]),
    );
    expect(fromP?.authorPubkey).toBe(BEN);
    expect(fromP?.ref.kind).toBe(1111);
    const fromRoot = noteCommentTarget(
      comment([
        ['E', NOTE],
        ['K', '1'],
        ['P', BEN],
      ]),
    );
    expect(fromRoot?.authorPubkey).toBe(BEN);
    expect(fromRoot?.ref.id).toBe(NOTE);
    // A nested parent never borrows the root's author.
    expect(
      noteCommentTarget(
        comment([
          ['E', NOTE],
          ['K', '1'],
          ['P', BEN],
          ['e', THREAD_REPLY],
        ]),
      )?.authorPubkey,
    ).toBeNull();
  });

  it('is null for anything that is not a note comment', () => {
    expect(
      noteCommentTarget(
        comment([
          ['A', `30402:${BEN}:x`],
          ['K', '30402'],
        ]),
      ),
    ).toBeNull();
    expect(noteCommentTarget({ kind: 1, pubkey: DEREK, tags: [['e', NOTE]] })).toBeNull();
  });
});
