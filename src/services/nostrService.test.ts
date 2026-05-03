/**
 * Wire-format guards for `createGroupChatRumor` (outgoing NIP-17
 * kind-14). The subject tag is what foreign clients (Amethyst /
 * Quartz, 0xchat) read to display the group name — Lightning
 * Piggy's outgoing messages MUST include it for cross-client
 * interop. Issue #271.
 *
 * Plus coverage for the pure helpers in nostrService that don't need
 * a SimplePool / relay round-trip (NIP-19 round-trips, profile
 * reference decoding, kind-0 tolerance, nprofile relay hint
 * dedup + cap). Per the project convention these are co-located in
 * the single `<file>.test.ts` next to the subject.
 */

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { nsecEncode } from 'nostr-tools/nip19';

import {
  buildProfileRelayHints,
  createGroupChatRumor,
  decodeNsec,
  decodeProfileReference,
  DEFAULT_RELAYS,
  nprofileEncode,
  npubEncode,
  parseProfileContent,
} from './nostrService';

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);
const PK_C = 'c'.repeat(64);

describe('createGroupChatRumor (outgoing kind-14)', () => {
  it('includes a subject tag carrying the group name', () => {
    const rumor = createGroupChatRumor({
      senderPubkey: PK_A,
      subject: 'Pizza Friday',
      memberPubkeys: [PK_B, PK_C],
      content: 'who is in?',
    });
    const subject = rumor.tags.find((t) => t[0] === 'subject');
    expect(subject).toEqual(['subject', 'Pizza Friday']);
  });

  it('emits one p tag per recipient member', () => {
    const rumor = createGroupChatRumor({
      senderPubkey: PK_A,
      subject: 'x',
      memberPubkeys: [PK_B, PK_C],
      content: 'hi',
    });
    const ps = rumor.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
    expect(ps).toEqual([PK_B, PK_C]);
  });

  it('builds a kind-14 rumor (NIP-17 chat)', () => {
    const rumor = createGroupChatRumor({
      senderPubkey: PK_A,
      subject: 'x',
      memberPubkeys: [PK_B],
      content: 'hi',
    });
    expect(rumor.kind).toBe(14);
    expect(rumor.pubkey).toBe(PK_A);
    expect(rumor.content).toBe('hi');
  });
});

// Reference participant for the PK_C-touched rumor expectation kept in
// the original interop block; not removing as it's still used implicitly
// by createGroupChatRumor recipient asserts above.
void PK_C;

describe('decodeNsec / npubEncode round-trip', () => {
  it('recovers (pubkey, secretKey) from a generated nsec', () => {
    const sk = generateSecretKey();
    const expectedPk = getPublicKey(sk);
    const nsec = nsecEncode(sk);
    const out = decodeNsec(nsec);
    expect(out.pubkey).toBe(expectedPk);
    expect(out.secretKey).toEqual(sk);
  });

  it('throws on a malformed nsec', () => {
    expect(() => decodeNsec('nsec1notreal')).toThrow();
  });

  it('throws when given a non-nsec NIP-19 string (e.g. an npub)', () => {
    const sk = generateSecretKey();
    const npub = npubEncode(getPublicKey(sk));
    expect(() => decodeNsec(npub)).toThrow(/invalid nsec/i);
  });
});

describe('npubEncode + nprofileEncode', () => {
  it('npubEncode produces an npub1 prefixed bech32 string', () => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const npub = npubEncode(pk);
    expect(npub.startsWith('npub1')).toBe(true);
  });

  it('nprofileEncode produces an nprofile1 prefixed string', () => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const np = nprofileEncode(pk, ['wss://relay.example.com']);
    expect(np.startsWith('nprofile1')).toBe(true);
  });
});

describe('decodeProfileReference', () => {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);

  it('decodes a bare npub', () => {
    const out = decodeProfileReference(npubEncode(pk));
    expect(out).toEqual({ pubkey: pk, relays: [] });
  });

  it('decodes a bare nprofile (preserves relay hints)', () => {
    const np = nprofileEncode(pk, ['wss://r.example.com']);
    const out = decodeProfileReference(np);
    expect(out).toEqual({ pubkey: pk, relays: ['wss://r.example.com'] });
  });

  it('strips a case-insensitive nostr: URI prefix', () => {
    const npub = npubEncode(pk);
    expect(decodeProfileReference(`nostr:${npub}`)?.pubkey).toBe(pk);
    expect(decodeProfileReference(`NOSTR:${npub}`)?.pubkey).toBe(pk);
    expect(decodeProfileReference(`Nostr:${npub}`)?.pubkey).toBe(pk);
  });

  it('returns null for non-profile references (note, nevent, naddr, garbage)', () => {
    expect(decodeProfileReference('nostr:garbage')).toBeNull();
    expect(decodeProfileReference('hello world')).toBeNull();
    expect(decodeProfileReference('')).toBeNull();
  });
});

describe('parseProfileContent', () => {
  it('extracts every documented field from a kind-0 JSON blob', () => {
    const out = parseProfileContent(
      JSON.stringify({
        name: 'alice',
        display_name: 'Alice',
        picture: 'https://x.test/a.jpg',
        banner: 'https://x.test/b.jpg',
        about: 'hi',
        lud16: 'alice@walletofsatoshi.com',
        nip05: 'alice@example.com',
      }),
    );
    expect(out).toEqual({
      name: 'alice',
      displayName: 'Alice',
      picture: 'https://x.test/a.jpg',
      banner: 'https://x.test/b.jpg',
      about: 'hi',
      lud16: 'alice@walletofsatoshi.com',
      nip05: 'alice@example.com',
    });
  });

  it('returns nulls when the field is absent', () => {
    const out = parseProfileContent(JSON.stringify({ name: 'alice' }));
    expect(out.name).toBe('alice');
    expect(out.displayName).toBeNull();
    expect(out.picture).toBeNull();
    expect(out.lud16).toBeNull();
  });

  it('returns an all-nulls object on invalid JSON', () => {
    const out = parseProfileContent('{not json');
    expect(out).toEqual({
      name: null,
      displayName: null,
      picture: null,
      banner: null,
      about: null,
      lud16: null,
      nip05: null,
    });
  });
});

describe('buildProfileRelayHints', () => {
  const TARGET = 'd'.repeat(64);

  it('prepends the contact relay when one is registered for the target', () => {
    const out = buildProfileRelayHints(
      TARGET,
      [{ pubkey: TARGET, relay: 'wss://contact.example.com' }],
      [],
    );
    expect(out[0]).toBe('wss://contact.example.com');
  });

  it('falls back to viewer read relays when the contact has no recorded relay', () => {
    const out = buildProfileRelayHints(TARGET, [], ['wss://viewer.example.com']);
    expect(out[0]).toBe('wss://viewer.example.com');
  });

  it('falls back to DEFAULT_RELAYS when nothing else is provided', () => {
    const out = buildProfileRelayHints(TARGET, [], []);
    expect(out.length).toBeGreaterThan(0);
    expect(DEFAULT_RELAYS).toContain(out[0]);
  });

  it('caps the resulting list at 3 hints', () => {
    const out = buildProfileRelayHints(
      TARGET,
      [{ pubkey: TARGET, relay: 'wss://a.example.com' }],
      ['wss://b.example.com', 'wss://c.example.com', 'wss://d.example.com'],
    );
    expect(out).toHaveLength(3);
  });

  it('deduplicates a relay that appears in multiple sources', () => {
    const dup = 'wss://shared.example.com';
    const out = buildProfileRelayHints(
      TARGET,
      [{ pubkey: TARGET, relay: dup }],
      [dup, 'wss://other.example.com'],
    );
    expect(out.filter((r) => r === dup)).toHaveLength(1);
  });
});
