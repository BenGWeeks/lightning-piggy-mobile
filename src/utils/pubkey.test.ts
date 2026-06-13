import { isHex64Pubkey, normalizePubkey } from './pubkey';

const VALID = 'a'.repeat(64);
const VALID_MIXED = 'A'.repeat(64);
// Zero-prefixed all-junk string truncated to 64 chars — the #855 symptom.
const ZERO_JUNK = '000000001c5c' + '0'.repeat(52);

describe('isHex64Pubkey', () => {
  it('accepts a 64-char lowercase hex string', () => {
    expect(isHex64Pubkey(VALID)).toBe(true);
    expect(isHex64Pubkey('0123456789abcdef'.repeat(4))).toBe(true);
  });

  it('treats zero-prefixed all-hex of the right length as valid', () => {
    // 64 hex chars is structurally a valid pubkey even if all-zero-ish;
    // isHex64Pubkey is a format check, not a liveness check.
    expect(ZERO_JUNK.length).toBe(64);
    expect(isHex64Pubkey(ZERO_JUNK)).toBe(true);
  });

  it('rejects mixed/upper-case (caller must normalise first)', () => {
    expect(isHex64Pubkey(VALID_MIXED)).toBe(false);
  });

  it('rejects wrong-length strings', () => {
    expect(isHex64Pubkey('a'.repeat(63))).toBe(false);
    expect(isHex64Pubkey('a'.repeat(65))).toBe(false);
    expect(isHex64Pubkey('')).toBe(false);
    expect(isHex64Pubkey('000000001c5c')).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isHex64Pubkey('g'.repeat(64))).toBe(false);
    expect(isHex64Pubkey('z' + 'a'.repeat(63))).toBe(false);
  });

  it('rejects null, undefined and non-strings', () => {
    expect(isHex64Pubkey(null)).toBe(false);
    expect(isHex64Pubkey(undefined)).toBe(false);
    expect(isHex64Pubkey(123)).toBe(false);
    expect(isHex64Pubkey({})).toBe(false);
  });
});

describe('normalizePubkey', () => {
  it('returns the lowercased canonical form for valid input', () => {
    expect(normalizePubkey(VALID_MIXED)).toBe(VALID);
    expect(normalizePubkey(VALID)).toBe(VALID);
  });

  it('returns null for wrong-length / non-hex / empty', () => {
    expect(normalizePubkey('a'.repeat(63))).toBeNull();
    expect(normalizePubkey('000000001c5c')).toBeNull();
    expect(normalizePubkey('g'.repeat(64))).toBeNull();
    expect(normalizePubkey('')).toBeNull();
  });

  it('returns null for null, undefined and non-strings', () => {
    expect(normalizePubkey(null)).toBeNull();
    expect(normalizePubkey(undefined)).toBeNull();
    expect(normalizePubkey(42)).toBeNull();
  });
});
