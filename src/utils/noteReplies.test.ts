import {
  dedupeReplyEchoes,
  isNoteOrNoteComment,
  isReplyInNoteThread,
  noteReplyFilters,
  noteReplyTarget,
} from './noteReplies';

const BEN = '9'.repeat(64);
const DEREK = '3'.repeat(64);
const NOTE = '7'.repeat(64);
const OTHER = '8'.repeat(64);

const kind1Reply = (id: string, content: string, parent = NOTE, pubkey = DEREK) => ({
  id,
  kind: 1,
  pubkey,
  content,
  tags: [
    ['e', parent, '', 'root', BEN],
    ['p', BEN],
  ],
});
const comment = (id: string, content: string, parent = NOTE, pubkey = DEREK) => ({
  id,
  kind: 1111,
  pubkey,
  content,
  tags: [
    ['E', NOTE, '', BEN],
    ['K', '1'],
    ['e', parent, '', BEN],
    ['k', '1'],
    ['p', BEN],
  ],
});

describe('noteReplyTarget / isNoteOrNoteComment', () => {
  it('handles kind-1 replies and note comments alike', () => {
    expect(noteReplyTarget(kind1Reply('a', 'hi'))?.ref.id).toBe(NOTE);
    expect(noteReplyTarget(comment('b', 'hi'))?.ref.id).toBe(NOTE);
    expect(noteReplyTarget({ kind: 7, pubkey: DEREK, tags: [['e', NOTE]] })).toBeNull();
  });

  it('keeps notes and note comments, not product comments', () => {
    expect(isNoteOrNoteComment({ kind: 1, pubkey: DEREK, tags: [] })).toBe(true);
    expect(isNoteOrNoteComment(comment('b', 'hi'))).toBe(true);
    expect(
      isNoteOrNoteComment({ kind: 1111, pubkey: DEREK, tags: [['A', `30402:${BEN}:x`]] }),
    ).toBe(false);
  });
});

describe('dedupeReplyEchoes', () => {
  it('drops a comment that echoes the same kind-1 reply, keeping order', () => {
    const top = { id: 't', kind: 1, pubkey: DEREK, content: 'gm', tags: [] };
    const events = [
      comment('c1', '  same   text '),
      top,
      kind1Reply('k1', 'same text'),
      comment('c2', 'different'),
    ];
    expect(dedupeReplyEchoes(events).map((e) => e.id)).toEqual(['t', 'k1', 'c2']);
  });

  it('keeps comments with a different parent or author', () => {
    const events = [
      kind1Reply('k1', 'same'),
      comment('c1', 'same', OTHER),
      comment('c2', 'same', NOTE, BEN),
    ];
    expect(dedupeReplyEchoes(events).map((e) => e.id)).toEqual(['k1', 'c1', 'c2']);
  });

  it('is a copy when nothing to dedupe', () => {
    const events = [comment('c1', 'x')];
    const out = dedupeReplyEchoes(events);
    expect(out).toEqual(events);
    expect(out).not.toBe(events);
  });
});

describe('noteReplyFilters', () => {
  it('asks for kind-1 replies and kind-1111 comments by root and parent, bounded', () => {
    expect(noteReplyFilters(NOTE, 50, 1000)).toEqual([
      { kinds: [1], '#e': [NOTE], limit: 50, since: 1000 },
      { kinds: [1111], '#E': [NOTE], limit: 50, since: 1000 },
      { kinds: [1111], '#e': [NOTE], limit: 50, since: 1000 },
    ]);
    expect(noteReplyFilters(NOTE, 10)[0]).toEqual({ kinds: [1], '#e': [NOTE], limit: 10 });
  });
});

describe('isReplyInNoteThread', () => {
  it('matches kind-1 replies by reply / root / positional e, not mentions', () => {
    expect(isReplyInNoteThread(kind1Reply('a', 'x'), NOTE)).toBe(true);
    expect(isReplyInNoteThread({ kind: 1, pubkey: DEREK, tags: [['e', NOTE]] }, NOTE)).toBe(true);
    expect(
      isReplyInNoteThread({ kind: 1, pubkey: DEREK, tags: [['e', NOTE, '', 'mention']] }, NOTE),
    ).toBe(false);
    expect(isReplyInNoteThread(kind1Reply('a', 'x', OTHER), NOTE)).toBe(false);
  });

  it('matches note comments by root or direct parent, never product comments', () => {
    expect(isReplyInNoteThread(comment('c', 'x'), NOTE)).toBe(true);
    // Root is NOTE, parent OTHER: in NOTE's thread, and a direct reply to OTHER.
    expect(isReplyInNoteThread(comment('c', 'x', OTHER), NOTE)).toBe(true);
    expect(isReplyInNoteThread(comment('c', 'x', OTHER), OTHER)).toBe(true);
    const product = {
      kind: 1111,
      pubkey: DEREK,
      tags: [
        ['A', `30402:${BEN}:x`],
        ['K', '30402'],
        ['e', NOTE],
        ['k', '30402'],
      ],
    };
    expect(isReplyInNoteThread(product, NOTE)).toBe(false);
  });
});
