/**
 * Wire-format guards for `subjectFromRumor` (incoming NIP-17 kind-14
 * subject-tag parser). Used by `tryRouteGroupRumor` to materialise
 * synthetic groups from foreign-client messages (Amethyst, 0xchat).
 * Issue #271.
 */

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { wrapEvent } from 'nostr-tools/nip59';
import {
  subjectFromRumor,
  textForRumor,
  partnerFromRumor,
  unwrapWrapNsec,
  type DecodedRumor,
} from './nip17Unwrap';

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

/**
 * Security characterisation for the #802 change: the gift-wrap schnorr
 * verify was dropped from the nsec decrypt path. These tests prove the
 * security model is unchanged — integrity is still enforced by the NIP-44
 * MAC, and authenticity by the seal ECDH — while the (redundant, expensive)
 * signature verify no longer gates the hot loop.
 */
describe('unwrapWrapNsec (NIP-17 nsec decrypt, post-#802)', () => {
  // Build a real NIP-17 gift wrap from `sender` to `recipient`.
  function makeWrap(content: string) {
    const senderSk = generateSecretKey();
    const recipientSk = generateSecretKey();
    const recipientPk = getPublicKey(recipientSk);
    const senderPk = getPublicKey(senderSk);
    const wrap = wrapEvent(
      { kind: 14, content, tags: [['p', recipientPk]] },
      senderSk,
      recipientPk,
    );
    return { wrap, recipientSk, senderPk };
  }

  // Cast helper — `wrapEvent` returns a fully-typed VerifiedEvent; the
  // unwrap function takes the looser RawGiftWrapEvent shape.
  type WrapArg = Parameters<typeof unwrapWrapNsec>[0];

  it('round-trips a kind-14 rumor (decrypt works without a sig verify)', () => {
    const { wrap, recipientSk, senderPk } = makeWrap('hello piggy');
    const rumor = unwrapWrapNsec(wrap as unknown as WrapArg, recipientSk);
    expect(rumor).not.toBeNull();
    expect(rumor?.content).toBe('hello piggy');
    expect(rumor?.kind).toBe(14);
    // Sender identity comes from the seal ECDH, surfaced as rumor.pubkey.
    expect(rumor?.pubkey).toBe(senderPk);
  });

  it('STILL decrypts when the wrap signature is invalid (verify is gone, #802)', () => {
    const { wrap, recipientSk } = makeWrap('sig should not matter');
    // Corrupt the ephemeral-key signature. Pre-#802 this returned null
    // ('wrap signature invalid'); now the sig is never consulted, so the
    // NIP-44 layers decrypt regardless — that's the whole point.
    (wrap as unknown as { sig: string }).sig = 'f'.repeat(128);
    const rumor = unwrapWrapNsec(wrap as unknown as WrapArg, recipientSk);
    expect(rumor?.content).toBe('sig should not matter');
  });

  it('still REJECTS a wrap whose ciphertext was tampered (MAC enforces integrity)', () => {
    const { wrap, recipientSk } = makeWrap('tamper me');
    // Flip one base64 char inside the wrap ciphertext → NIP-44 MAC mismatch
    // → decrypt throws → unwrapWrapNsec skips (returns null). This is the
    // guarantee that replaced the schnorr verify: integrity is preserved.
    const i = 60;
    const swapped = wrap.content[i] === 'A' ? 'B' : 'A';
    const tampered = wrap.content.slice(0, i) + swapped + wrap.content.slice(i + 1);
    const onSkip = jest.fn();
    const rumor = unwrapWrapNsec(
      { ...wrap, content: tampered } as unknown as WrapArg,
      recipientSk,
      onSkip,
    );
    expect(rumor).toBeNull();
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
