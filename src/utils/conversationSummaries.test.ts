import { buildDmSummaries, type DmInboxEntry } from './conversationSummaries';
import type { NostrContact } from '../types/nostr';

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
  profile: { pubkey: FOLLOWED, npub: '', name: 'Alice', displayName: null, picture: null, banner: null, about: null, lud16: null, nip05: null },
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

  it('keeps unfollowed senders when followPubkeys is undefined (devMode + Following-only=off)', () => {
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
