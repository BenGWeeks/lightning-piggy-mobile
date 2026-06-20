import { sanitizeContacts, resolveForcedRefreshContacts } from './contacts';
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

  it('returns an empty array for non-array input (corrupt cache)', () => {
    // JSON.parse of a corrupt blob can yield null / object / string —
    // sanitizeContacts must coerce, not throw (Copilot #874).
    expect(sanitizeContacts(null)).toEqual([]);
    expect(sanitizeContacts(undefined)).toEqual([]);
    expect(sanitizeContacts({ pubkey: A })).toEqual([]);
    expect(sanitizeContacts('not-an-array')).toEqual([]);
  });
});

describe('resolveForcedRefreshContacts', () => {
  const cached = [contact(A), contact(B)];

  it('keeps the cached follows when the forced fetch times out (null) — the #908 bug', () => {
    // The regression: a forced pull-to-refresh whose relay fetch returns null
    // must NOT wipe the visible list to "No contacts found".
    expect(resolveForcedRefreshContacts(null, cached)).toBe(cached);
  });

  it('paints empty on a null fetch only when nothing is cached', () => {
    expect(resolveForcedRefreshContacts(null, null)).toEqual([]);
    expect(resolveForcedRefreshContacts(null, [])).toEqual([]);
  });

  it('uses a non-null fetch as authoritative, replacing the cache', () => {
    const fresh = [contact(MIXED)];
    expect(resolveForcedRefreshContacts(fresh, cached)).toBe(fresh);
  });

  it('treats an empty (but non-null) fetch as authoritative — a user who follows nobody', () => {
    // Distinct from the timeout case: [] means "confirmed zero follows", so it
    // legitimately clears the list rather than falling back to the cache.
    expect(resolveForcedRefreshContacts([], cached)).toEqual([]);
  });
});
