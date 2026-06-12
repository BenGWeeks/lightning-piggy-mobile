/**
 * Wire-format guards for `subjectFromRumor` (incoming NIP-17 kind-14
 * subject-tag parser). Used by `tryRouteGroupRumor` to materialise
 * synthetic groups from foreign-client messages (Amethyst, 0xchat).
 * Issue #271.
 */

import { subjectFromRumor, textForRumor, partnerFromRumor, type DecodedRumor } from './nip17Unwrap';

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);

describe('subjectFromRumor (incoming kind-14)', () => {
  function rumorWithTags(tags: string[][]): DecodedRumor {
    return {
      pubkey: PK_A,
      created_at: 1,
      kind: 14,
      tags,
      content: '',
    };
  }

  it('returns the subject value when present', () => {
    expect(subjectFromRumor(rumorWithTags([['subject', 'Hello']]))).toBe('Hello');
  });

  it('returns null when there is no subject tag', () => {
    expect(subjectFromRumor(rumorWithTags([['p', PK_B]]))).toBeNull();
  });

  it('returns null when subject is whitespace-only', () => {
    expect(subjectFromRumor(rumorWithTags([['subject', '   ']]))).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(subjectFromRumor(rumorWithTags([['subject', '  Pizza Friday  ']]))).toBe('Pizza Friday');
  });
});

describe('partnerFromRumor (partner-pubkey extraction + validation, #849)', () => {
  const ME = PK_A;
  const rumor = (over: Partial<DecodedRumor>): DecodedRumor => ({
    pubkey: PK_B,
    created_at: 1,
    kind: 14,
    tags: [],
    content: '',
    ...over,
  });

  it('incoming: sender is the partner, lowercased', () => {
    expect(partnerFromRumor(rumor({ pubkey: PK_B }), ME)).toEqual({
      partnerPubkey: PK_B,
      fromMe: false,
    });
  });

  it('incoming: lowercases a mixed-case sender pubkey (was leaking as raw-hex)', () => {
    const mixed = 'D'.repeat(64);
    expect(partnerFromRumor(rumor({ pubkey: mixed }), ME)).toEqual({
      partnerPubkey: 'd'.repeat(64),
      fromMe: false,
    });
  });

  it('incoming: returns null for a malformed sender pubkey (the dcc… junk fix)', () => {
    expect(partnerFromRumor(rumor({ pubkey: 'dcc123' }), ME)).toBeNull();
    expect(partnerFromRumor(rumor({ pubkey: 'z'.repeat(64) }), ME)).toBeNull();
  });

  it('fromMe: reads the p-tag partner, validated + lowercased', () => {
    expect(partnerFromRumor(rumor({ pubkey: ME, tags: [['p', PK_B.toUpperCase()]] }), ME)).toEqual({
      partnerPubkey: PK_B,
      fromMe: true,
    });
  });

  it('fromMe: returns null when the p-tag partner is missing or malformed', () => {
    expect(partnerFromRumor(rumor({ pubkey: ME, tags: [] }), ME)).toBeNull();
    expect(partnerFromRumor(rumor({ pubkey: ME, tags: [['p', 'nope']] }), ME)).toBeNull();
  });
});

describe('textForRumor (kind-15 → bubble text)', () => {
  const fileRumor = (mime: string, alg: string): DecodedRumor => ({
    pubkey: PK_A,
    created_at: 0,
    kind: 15,
    content: 'https://blossom.example/abc.bin',
    tags: [
      ['file-type', mime],
      ['encryption-algorithm', alg],
      ['decryption-key', 'a'.repeat(64)],
      ['decryption-nonce', 'b'.repeat(24)],
    ],
  });

  it('encodes an AES-GCM audio voice note into the #lpe URL', () => {
    const out = textForRumor(fileRumor('audio/mp4', 'aes-gcm'));
    expect(out).toContain('#lpe=1');
    expect(out).toContain('k=' + 'a'.repeat(64));
  });

  it('encodes an AES-GCM image into the #lpe URL (#688)', () => {
    const out = textForRumor(fileRumor('image/jpeg', 'aes-gcm'));
    expect(out).toContain('#lpe=1');
    expect(out).toContain('k=' + 'a'.repeat(64));
    expect(out).toContain('m=image%2Fjpeg');
  });

  it('does NOT leak the key for an unrenderable mime kind-15 (keeps bare content)', () => {
    const out = textForRumor(fileRumor('application/pdf', 'aes-gcm'));
    expect(out).toBe('https://blossom.example/abc.bin');
    expect(out).not.toContain('lpe=1');
    expect(out).not.toContain('a'.repeat(64)); // the decryption key
  });

  it('does NOT leak the key for a non-aes-gcm audio kind-15', () => {
    const out = textForRumor(fileRumor('audio/mp4', 'chacha20'));
    expect(out).toBe('https://blossom.example/abc.bin');
    expect(out).not.toContain('a'.repeat(64));
  });

  it('does NOT leak the key for a non-aes-gcm image kind-15', () => {
    const out = textForRumor(fileRumor('image/png', 'chacha20'));
    expect(out).toBe('https://blossom.example/abc.bin');
    expect(out).not.toContain('a'.repeat(64));
  });

  it('returns plain content for a kind-14 text rumor', () => {
    expect(
      textForRumor({ pubkey: PK_A, created_at: 0, kind: 14, content: 'hi there', tags: [] }),
    ).toBe('hi there');
  });
});
