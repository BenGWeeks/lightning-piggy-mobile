import type { NostrContact } from '../types/nostr';
import {
  buildGroupMemberRows,
  membersNeedingProfiles,
  type MemberProfile,
} from './groupMemberRows';
import { shortNpub } from './shortNpub';

const SELF = 'a'.repeat(64);
const FRIEND = 'b'.repeat(64);
const STRANGER = 'c'.repeat(64);
const UNKNOWN = 'd'.repeat(64);

const contact = (
  pubkey: string,
  profile: Partial<NostrContact['profile']> | null,
  petname: string | null = null,
): NostrContact => ({ pubkey, relay: null, petname, profile }) as NostrContact;

const NO_PROFILES: ReadonlyMap<string, MemberProfile> = new Map();

describe('membersNeedingProfiles', () => {
  it('returns non-self members missing from the follow list, lower-cased and deduped', () => {
    const out = membersNeedingProfiles(
      [SELF.toUpperCase(), FRIEND, STRANGER.toUpperCase(), STRANGER],
      SELF,
      [contact(FRIEND.toUpperCase(), null)],
    );
    expect(out).toEqual([STRANGER]);
  });

  it('returns nothing for an empty group', () => {
    expect(membersNeedingProfiles([], SELF, [])).toEqual([]);
  });
});

describe('buildGroupMemberRows', () => {
  it('puts self first, never as following, and dedupes a self-included member list', () => {
    const rows = buildGroupMemberRows({
      memberPubkeys: [SELF, FRIEND],
      selfPubkey: SELF,
      selfProfile: { displayName: 'Big Piggy', name: 'big', picture: 'https://x/me.png' },
      contacts: [contact(FRIEND, { name: 'friend' })],
      profiles: NO_PROFILES,
    });
    expect(rows.map((r) => r.pubkey)).toEqual([SELF, FRIEND]);
    expect(rows[0]).toEqual({
      pubkey: SELF,
      name: 'Big Piggy',
      picture: 'https://x/me.png',
      isSelf: true,
      following: false,
    });
  });

  it('marks followed members and resolves strangers from fetched profiles', () => {
    const rows = buildGroupMemberRows({
      memberPubkeys: [FRIEND, STRANGER],
      selfPubkey: SELF,
      selfProfile: null,
      contacts: [contact(FRIEND, { displayName: 'Friend', picture: 'https://x/f.png' })],
      profiles: new Map([
        [STRANGER, { name: 'stranger', displayName: ' ', picture: 'https://x/s.png' }],
      ]),
    });
    const [, friend, stranger] = rows;
    expect(friend).toMatchObject({ name: 'Friend', picture: 'https://x/f.png', following: true });
    // Blank displayName falls through to name.
    expect(stranger).toMatchObject({
      name: 'stranger',
      picture: 'https://x/s.png',
      following: false,
    });
  });

  it('falls back to a short npub (not hex) when no profile is known', () => {
    const rows = buildGroupMemberRows({
      memberPubkeys: [UNKNOWN],
      selfPubkey: SELF,
      selfProfile: null,
      contacts: [],
      profiles: NO_PROFILES,
    });
    expect(rows[0].name).toBe(shortNpub(SELF));
    expect(rows[1].name).toBe(shortNpub(UNKNOWN));
    expect(rows[1].name.startsWith('npub1')).toBe(true);
  });

  it('uses a followed contact petname before the npub fallback', () => {
    const rows = buildGroupMemberRows({
      memberPubkeys: [FRIEND],
      selfPubkey: null,
      selfProfile: null,
      contacts: [contact(FRIEND, null, 'Bestie')],
      profiles: NO_PROFILES,
    });
    expect(rows).toEqual([
      { pubkey: FRIEND, name: 'Bestie', picture: null, isSelf: false, following: true },
    ]);
  });
});
