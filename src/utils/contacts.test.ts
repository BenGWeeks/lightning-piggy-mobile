import { sanitizeContacts } from './contacts';
import type { NostrContact } from '../types/nostr';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const MIXED = 'C'.repeat(64);
const ZERO_JUNK = '000000001c5c'; // wrong length — the #855 symptom

const contact = (pubkey: string, extra: Partial<NostrContact> = {}): NostrContact => ({
  pubkey,
  relay: null,
  petname: null,
  profile: null,
  ...extra,
});

describe('sanitizeContacts', () => {
  it('keeps valid 64-hex contacts', () => {
    const result = sanitizeContacts([contact(A), contact(B)]);
    expect(result.map((c) => c.pubkey)).toEqual([A, B]);
  });

  it('drops zero-prefixed junk / wrong-length / non-hex pubkeys', () => {
    const result = sanitizeContacts([
      contact(A),
      contact(ZERO_JUNK),
      contact('a'.repeat(63)),
      contact('g'.repeat(64)),
    ]);
    expect(result.map((c) => c.pubkey)).toEqual([A]);
  });

  it('lowercases mixed-case pubkeys while preserving other fields', () => {
    const result = sanitizeContacts([contact(MIXED, { petname: 'Bob', relay: 'wss://r' })]);
    expect(result).toEqual([
      { pubkey: 'c'.repeat(64), relay: 'wss://r', petname: 'Bob', profile: null },
    ]);
  });

  it('de-duplicates after lowercasing', () => {
    const result = sanitizeContacts([contact(A), contact('A'.repeat(64)), contact(A)]);
    expect(result.map((c) => c.pubkey)).toEqual([A]);
  });

  it('drops entries with null / undefined / non-string pubkeys', () => {
    const result = sanitizeContacts([
      contact(A),
      // @ts-expect-error testing runtime junk
      contact(null),
      // @ts-expect-error testing runtime junk
      contact(undefined),
      // @ts-expect-error testing runtime junk
      contact(123),
    ]);
    expect(result.map((c) => c.pubkey)).toEqual([A]);
  });

  it('returns an empty array when everything is junk', () => {
    expect(sanitizeContacts([contact(ZERO_JUNK), contact('')])).toEqual([]);
  });
});
