import * as nip19 from 'nostr-tools/nip19';
import { isReply, replyTarget } from './nip10';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const THIRD = 'c'.repeat(64);
const ROOT = '1'.repeat(64);
const PARENT = '2'.repeat(64);
const QUOTED = '3'.repeat(64);
const note = (tags: string[][], kind = 1) => ({ kind, pubkey: ME, tags });

describe('isReply (NIP-10)', () => {
  it('treats a note with no e tags as a top-level post', () => {
    expect(isReply(note([]))).toBe(false);
    expect(isReply(note([['p', OTHER]]))).toBe(false);
  });

  it('counts marked reply / root e tags as replies', () => {
    expect(isReply(note([['e', ROOT, '', 'root']]))).toBe(true);
    expect(
      isReply(
        note([
          ['e', ROOT, '', 'root'],
          ['e', PARENT, 'wss://relay.example', 'reply'],
        ]),
      ),
    ).toBe(true);
  });

  it('does not count mention-only e tags, q tags or content references', () => {
    expect(isReply(note([['e', QUOTED, '', 'mention']]))).toBe(false);
    expect(isReply(note([['q', QUOTED]]))).toBe(false);
    const withContentRef = {
      ...note([]),
      content: `look nostr:${nip19.noteEncode(QUOTED)}`,
    };
    expect(isReply(withContentRef)).toBe(false);
  });

  it('counts any legacy positional e tag as a reply', () => {
    expect(isReply(note([['e', PARENT]]))).toBe(true);
    expect(isReply(note([['e', ROOT, 'wss://relay.example']]))).toBe(true);
  });

  it('ignores malformed e tags and non-notes', () => {
    expect(isReply(note([['e', 'not-hex']]))).toBe(false);
    expect(isReply(note([['e', PARENT, '', 'reply']], 20))).toBe(false);
  });
});

describe('replyTarget', () => {
  it('prefers the reply-marked parent and its NIP-10 pubkey', () => {
    const t = replyTarget(
      note([
        ['e', ROOT, '', 'root', THIRD],
        ['e', PARENT, 'wss://relay.example', 'reply', OTHER],
        ['p', THIRD],
      ]),
    );
    expect(t?.ref.id).toBe(PARENT);
    expect(t?.ref.relays).toEqual(['wss://relay.example']);
    expect(t?.authorPubkey).toBe(OTHER);
    expect(t?.ref.raw.startsWith('nostr:nevent1')).toBe(true);
  });

  it('falls back to root, then to the first p tag that is not the author', () => {
    const t = replyTarget(
      note([
        ['e', ROOT, '', 'root'],
        ['p', ME],
        ['p', OTHER],
      ]),
    );
    expect(t?.ref.id).toBe(ROOT);
    expect(t?.authorPubkey).toBe(OTHER);
  });

  it('uses the last positional e tag as the parent and drops unsafe relay hints', () => {
    const t = replyTarget(
      note([
        ['e', ROOT],
        ['e', PARENT, 'ws://192.168.1.2'],
      ]),
    );
    expect(t?.ref.id).toBe(PARENT);
    expect(t?.ref.relays).toEqual([]);
    expect(t?.authorPubkey).toBeNull();
  });

  it('returns null for a top-level post', () => {
    expect(replyTarget(note([['e', QUOTED, '', 'mention']]))).toBeNull();
  });
});
