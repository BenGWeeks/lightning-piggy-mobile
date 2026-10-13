import { npubEncode } from 'nostr-tools/nip19';
import { buildFollowSet, isFollowed } from './followPubkeys';

it('compares hex consistently across kind-3, legacy npub and mixed-case keys (#1458)', () => {
  const hex = 'a'.repeat(64);
  const follows = buildFollowSet([npubEncode(hex), hex.toUpperCase(), 'junk']);
  expect([...follows]).toEqual([hex]);
  expect(isFollowed(follows, hex.toUpperCase())).toBe(true);
  expect(isFollowed(follows, npubEncode(hex))).toBe(true);
  expect(isFollowed(follows, 'b'.repeat(64))).toBe(false);
});
