import { nprofileEncode, npubEncode } from 'nostr-tools/nip19';
import { decodeProfileReference } from './profileReference';
const pubkey = 'a'.repeat(64);
it('drops blocked nprofile hints and caps accepted hints before connecting', () => {
  const relays = [
    'ws://relay.example',
    'wss://127.0.0.1',
    'wss://relay.example:8443',
    ...[1, 2, 3, 4].map((i) => `wss://relay${i}.example`),
  ];
  expect(decodeProfileReference(nprofileEncode({ pubkey, relays }))).toEqual({
    pubkey,
    relays: relays.slice(3, 6),
  });
});
it('accepts npub and safe nprofile hints', () => {
  expect(decodeProfileReference(npubEncode(pubkey))).toEqual({ pubkey, relays: [] });
  expect(
    decodeProfileReference(nprofileEncode({ pubkey, relays: ['wss://relay.example'] })),
  ).toEqual({ pubkey, relays: ['wss://relay.example'] });
});
it('ignores malformed profile references', () => {
  expect(decodeProfileReference('garbage')).toBeNull();
});
