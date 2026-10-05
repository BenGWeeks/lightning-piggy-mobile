import { mergeSummaries, buildDmSummaries, type DmInboxEntry } from './conversationSummaries';
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

describe('conversation protocol metadata', () => {
  it.each([false, true])(
    'keeps dual-published copies in separate rows (reversed=%s)',
    (reverse) => {
      const entries = [
        entry(FOLLOWED, { wireKind: 14, createdAt: 100 }),
        entry(FOLLOWED, { wireKind: 4, createdAt: 110 }),
        entry(FOLLOWED, { wireKind: 15, createdAt: 105, text: 'file' }),
        entry(FOLLOWED, { wireKind: 4, createdAt: 90 }),
      ];
      const rows = buildDmSummaries(reverse ? entries.reverse() : entries, []);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        id: `${FOLLOWED}:nip04`,
        pubkey: FOLLOWED,
        protocol: 'nip04',
        lastActivityAt: 110,
      });
      expect(rows[1]).toMatchObject({
        id: `${FOLLOWED}:nip17`,
        pubkey: FOLLOWED,
        protocol: 'nip17',
        lastActivityAt: 105,
        lastComment: 'file',
      });
    },
  );
  it('treats historical inbox entries without a wire kind as NIP-17', () => {
    expect(buildDmSummaries([entry(FOLLOWED, { wireKind: undefined })], [])[0]).toMatchObject({
      id: `${FOLLOWED}:nip17`,
      protocol: 'nip17',
    });
  });
  it.each([5, 100, 1000])(
    'merges zaps only into NIP-17 with existing preview rules at %i',
    (createdAt) => {
      const dm = buildDmSummaries(
        [
          entry(FOLLOWED, { wireKind: 4, createdAt: 20 }),
          entry(FOLLOWED, { wireKind: 14, createdAt: 10 }),
        ],
        [],
      );
      const zap = {
        ...dm[0],
        id: FOLLOWED,
        protocol: undefined,
        lastActivityAt: createdAt,
        lastComment: 'zap',
        lastAmountSats: 21,
      };
      const rows = mergeSummaries([zap], dm);
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.protocol === 'nip04')).toBe(dm[0]);
      expect(rows.find((r) => r.protocol === 'nip17')).toMatchObject({
        id: `${FOLLOWED}:nip17`,
        pubkey: FOLLOWED,
        lastActivityAt: Math.max(createdAt, 10),
        lastComment: createdAt <= 310 ? 'hi' : 'zap',
        lastAmountSats: createdAt <= 310 ? 0 : 21,
      });
      expect(mergeSummaries([zap], [])).toEqual([zap]);
    },
  );
  it('keeps a zap standalone alongside only NIP-04 and preserves anonymous rows', () => {
    const dm = buildDmSummaries([entry(FOLLOWED, { wireKind: 4, createdAt: 10 })], []);
    const zap = { ...dm[0], id: FOLLOWED, protocol: undefined, lastActivityAt: 100 };
    const anonymous = {
      ...zap,
      id: 'anon:wallet:hash',
      pubkey: null,
      anonymous: true,
      lastActivityAt: 200,
    };
    expect(mergeSummaries([zap, anonymous], dm)).toEqual([anonymous, zap, dm[0]]);
  });
});
