import { buildDmSummaries, type DmInboxEntry } from './conversationSummaries';
import type { NostrContact, NostrProfile } from '../types/nostr';

const FOLLOWED = 'a'.repeat(64);
const UNFOLLOWED = 'b'.repeat(64);

const entry = (partnerPubkey: string, overrides: Partial<DmInboxEntry> = {}): DmInboxEntry => ({
  id: 'evt-' + partnerPubkey.slice(0, 8) + '-' + (overrides.createdAt ?? 1),
  partnerPubkey,
  fromMe: false,
  createdAt: 1700000000,
  text: 'hi',
  wireKind: 14,
  ...overrides,
});

const followedContact: NostrContact = {
  pubkey: FOLLOWED,
  relay: null,
  petname: null,
  profile: {
    pubkey: FOLLOWED,
    npub: '',
    name: 'Alice',
    displayName: null,
    picture: null,
    banner: null,
    about: null,
    lud16: null,
    nip05: null,
  },
};

describe('buildDmSummaries follow gate', () => {
  it('drops unfollowed senders when followPubkeys is provided (default parental-control)', () => {
    const result = buildDmSummaries(
      [entry(FOLLOWED), entry(UNFOLLOWED)],
      [followedContact],
      new Set([FOLLOWED]),
    );
    expect(result).toHaveLength(1);
    expect(result[0].pubkey).toBe(FOLLOWED);
  });

  it('keeps unfollowed senders when followPubkeys is undefined (secretMode + Following-only=off)', () => {
    const result = buildDmSummaries(
      [entry(FOLLOWED), entry(UNFOLLOWED)],
      [followedContact],
      undefined,
    );
    expect(result).toHaveLength(2);
    const pubkeys = result.map((r) => r.pubkey).sort();
    expect(pubkeys).toEqual([FOLLOWED, UNFOLLOWED].sort());
  });

  it('still applies the gate when followPubkeys is an empty Set (not undefined)', () => {
    // Distinguishes `undefined` (skip filter entirely) from `new Set()`
    // (apply filter, but follow set is empty → drop all).
    const result = buildDmSummaries(
      [entry(FOLLOWED), entry(UNFOLLOWED)],
      [followedContact],
      new Set<string>(),
    );
    expect(result).toHaveLength(0);
  });
});

describe('buildDmSummaries malformed-pubkey filter (#849)', () => {
  it('drops entries whose partner pubkey is not 64 hex chars (the dcc… junk rows)', () => {
    // Pre-fix junk rows already in the store: short hex, non-hex, wrong length.
    const result = buildDmSummaries(
      [entry(FOLLOWED), entry('dcc123'), entry('z'.repeat(64)), entry('a'.repeat(63))],
      [followedContact],
      undefined,
    );
    expect(result).toHaveLength(1);
    expect(result[0].pubkey).toBe(FOLLOWED);
  });

  it('keeps a valid mixed-case pubkey (matched case-insensitively via lowercase key)', () => {
    const result = buildDmSummaries([entry('C'.repeat(64))], [], undefined);
    expect(result).toHaveLength(1);
    expect(result[0].pubkey?.toLowerCase()).toBe('c'.repeat(64));
  });
});

describe('buildDmSummaries non-followed profile resolution (#664)', () => {
  const evilProfile: NostrProfile = {
    pubkey: UNFOLLOWED,
    npub: '',
    name: 'Evil Piggy',
    displayName: null,
    picture: 'https://example.com/evil.png',
    banner: null,
    about: null,
    lud16: null,
    nip05: null,
  };

  it('resolves a non-contact sender name + avatar from extraProfiles', () => {
    const result = buildDmSummaries(
      [entry(UNFOLLOWED)],
      [], // not in the contact list
      undefined,
      new Map([[UNFOLLOWED.toLowerCase(), evilProfile]]),
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Evil Piggy');
    expect(result[0].picture).toBe('https://example.com/evil.png');
  });

  it('falls back to an npub-style name (not a profile) when none is known', () => {
    const result = buildDmSummaries([entry(UNFOLLOWED)], [], undefined);
    expect(result).toHaveLength(1);
    expect(result[0].name).not.toBe('Evil Piggy');
    expect(result[0].picture).toBeNull();
  });

  it('prefers a real contact profile over extraProfiles', () => {
    const result = buildDmSummaries(
      [entry(FOLLOWED)],
      [followedContact],
      undefined,
      new Map([[FOLLOWED.toLowerCase(), evilProfile]]),
    );
    expect(result[0].name).toBe('Alice');
  });
});
