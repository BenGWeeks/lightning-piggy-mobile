/**
 * Guards for the pure deep-link/NFC profile-reference helpers (#754):
 * URI claiming + projection of a fetched kind-0 (or a pubkey-only stub)
 * into the ContactProfile route's data shape.
 */
import {
  isProfileReferenceUri,
  profileToContactBody,
  pubkeyToContactBodyStub,
} from './nostrProfileLink';
import { npubEncode, nprofileEncode } from '../services/nostrService';
import type { NostrProfile } from '../types/nostr';

const PK = 'a'.repeat(64);
const NPUB = npubEncode(PK);
const NPROFILE = nprofileEncode(PK, ['wss://relay.example']);

describe('isProfileReferenceUri', () => {
  it('claims npub / nprofile with or without the nostr: scheme', () => {
    expect(isProfileReferenceUri(`nostr:${NPUB}`)).toBe(true);
    expect(isProfileReferenceUri(`nostr:${NPROFILE}`)).toBe(true);
    expect(isProfileReferenceUri(NPUB)).toBe(true);
    expect(isProfileReferenceUri(NPROFILE)).toBe(true);
  });

  it('is case-insensitive on the scheme', () => {
    expect(isProfileReferenceUri(`NOSTR:${NPUB}`)).toBe(true);
  });

  it('does NOT claim naddr / note / lightning / hunt URIs', () => {
    expect(isProfileReferenceUri('nostr:naddr1abcdef')).toBe(false);
    expect(isProfileReferenceUri('nostr:note1abcdef')).toBe(false);
    expect(isProfileReferenceUri('lightning:lnurl1abcdef')).toBe(false);
    expect(isProfileReferenceUri('lightningpiggy://hunt/x')).toBe(false);
  });

  it('tolerates surrounding whitespace', () => {
    expect(isProfileReferenceUri(`  nostr:${NPUB}  `)).toBe(true);
  });
});

describe('profileToContactBody', () => {
  const base: NostrProfile = {
    pubkey: PK,
    npub: NPUB,
    name: 'satoshi',
    displayName: 'Satoshi N',
    picture: 'https://img.example/a.png',
    banner: 'https://img.example/b.png',
    about: 'gm',
    lud16: 'satoshi@example.com',
    nip05: 'satoshi@example.com',
  };

  it('maps a full profile, preferring displayName', () => {
    const body = profileToContactBody(base);
    expect(body).toEqual({
      pubkey: PK,
      name: 'Satoshi N',
      picture: 'https://img.example/a.png',
      banner: 'https://img.example/b.png',
      nip05: 'satoshi@example.com',
      about: 'gm',
      lightningAddress: 'satoshi@example.com',
      source: 'nostr',
    });
  });

  it('falls back to name, then a truncated npub, for the header', () => {
    expect(profileToContactBody({ ...base, displayName: null }).name).toBe('satoshi');
    const anon = profileToContactBody({ ...base, displayName: null, name: null });
    expect(anon.name).toBe(`${NPUB.slice(0, 12)}…`);
  });

  it('normalises missing optional fields to null', () => {
    const sparse = profileToContactBody({
      ...base,
      picture: null,
      banner: null,
      about: null,
      lud16: null,
      nip05: null,
    });
    expect(sparse.picture).toBeNull();
    expect(sparse.lightningAddress).toBeNull();
    expect(sparse.about).toBeNull();
  });
});

describe('pubkeyToContactBodyStub', () => {
  it('builds a navigable stub from a bare pubkey', () => {
    const stub = pubkeyToContactBodyStub(PK);
    expect(stub.pubkey).toBe(PK);
    expect(stub.source).toBe('nostr');
    expect(stub.name).toBe(`${NPUB.slice(0, 12)}…`);
    expect(stub.lightningAddress).toBeNull();
    // `about` left undefined so ContactProfileScreen's lazy fetch fires.
    expect(stub.about).toBeUndefined();
  });
});
