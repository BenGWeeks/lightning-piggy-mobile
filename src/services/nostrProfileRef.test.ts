/**
 * Round-trip + hint guards for the `nostr:` profile reference path that
 * backs NFC contact badges + deep links (#754 read / #755 write):
 *
 *  - `nprofileEncode` → `decodeProfileReference` must preserve the pubkey
 *    AND the embedded relay hints (the whole reason nprofile beats a bare
 *    npub for cold first contact).
 *  - `decodeProfileReference` must accept the `nostr:` URI prefix (NIP-21,
 *    case-insensitive) and a bare bech32 alike, and reject non-profile
 *    entities (naddr / note) by returning null.
 *  - `buildOwnProfileRelayHints` must prefer the user's own write relays,
 *    cap to keep an NTAG213 payload small, and fall back to defaults so a
 *    relay-less user still ships a hint.
 */
import { noteEncode } from 'nostr-tools/nip19';
import {
  npubEncode,
  nprofileEncode,
  decodeProfileReference,
  buildOwnProfileRelayHints,
  DEFAULT_RELAYS,
} from './nostrService';

const PK = 'a'.repeat(64);

describe('decodeProfileReference', () => {
  it('round-trips an nprofile preserving pubkey + relay hints', () => {
    const hints = ['wss://relay.example.com', 'wss://nos.lol'];
    const nprofile = nprofileEncode(PK, hints);
    const decoded = decodeProfileReference(`nostr:${nprofile}`);
    expect(decoded).not.toBeNull();
    expect(decoded?.pubkey).toBe(PK);
    expect(decoded?.relays).toEqual(hints);
  });

  it('decodes a bare npub to the pubkey with no relay hints', () => {
    const npub = npubEncode(PK);
    expect(decodeProfileReference(npub)).toEqual({ pubkey: PK, relays: [] });
  });

  it('accepts the nostr: scheme case-insensitively', () => {
    const npub = npubEncode(PK);
    expect(decodeProfileReference(`NOSTR:${npub}`)?.pubkey).toBe(PK);
    expect(decodeProfileReference(`Nostr:${npub}`)?.pubkey).toBe(PK);
  });

  it('returns null for a non-profile entity (note id)', () => {
    // A 32-byte note id, not a profile — must not be claimed as a profile.
    const note = noteEncode('b'.repeat(64));
    expect(decodeProfileReference(`nostr:${note}`)).toBeNull();
  });

  it('returns null for garbage', () => {
    expect(decodeProfileReference('nostr:notabech32')).toBeNull();
    expect(decodeProfileReference('')).toBeNull();
  });
});

describe('buildOwnProfileRelayHints (#755)', () => {
  it('prefers the user write relays, capped to the requested max', () => {
    const writeRelays = ['wss://a.example', 'wss://b.example', 'wss://c.example'];
    expect(buildOwnProfileRelayHints(writeRelays, 2)).toEqual([
      'wss://a.example',
      'wss://b.example',
    ]);
  });

  it('falls back to app defaults when the user has no write relays', () => {
    const hints = buildOwnProfileRelayHints([], 2);
    expect(hints).toHaveLength(2);
    expect(hints).toEqual(DEFAULT_RELAYS.slice(0, 2));
  });

  it('tops up from defaults when the user has fewer than max write relays', () => {
    const hints = buildOwnProfileRelayHints(['wss://only.example'], 2);
    expect(hints[0]).toBe('wss://only.example');
    expect(hints).toHaveLength(2);
    expect(hints[1]).toBe(DEFAULT_RELAYS[0]);
  });

  it('dedupes a write relay that also appears in defaults', () => {
    const hints = buildOwnProfileRelayHints([DEFAULT_RELAYS[0]], 3);
    // No duplicate of DEFAULT_RELAYS[0].
    expect(hints.filter((r) => r === DEFAULT_RELAYS[0])).toHaveLength(1);
  });

  it('an encoded own-nprofile decodes back to the same pubkey + hints', () => {
    const hints = buildOwnProfileRelayHints(['wss://outbox.example'], 2);
    const nprofile = nprofileEncode(PK, hints);
    const decoded = decodeProfileReference(`nostr:${nprofile}`);
    expect(decoded?.pubkey).toBe(PK);
    expect(decoded?.relays).toEqual(hints);
  });
});
