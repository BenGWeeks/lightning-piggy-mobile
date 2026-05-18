// Contract guards for the dev-event deny-list. The data itself is the
// interesting thing (which pubkeys we filter) — these tests assert the
// data has the right shape and that the membership-test helper does
// what it says, so a future refactor (e.g. switching from Set to Map,
// or env-overriding the list) can't silently regress the predicate.

import { DEV_LEFTOVER_PUBKEYS, isDevLeftover } from './devEventDenylist';

describe('devEventDenylist', () => {
  describe('DEV_LEFTOVER_PUBKEYS', () => {
    it('contains the four disposable-nsec Geo-Cache 1 signers', () => {
      // These are the four signers discovered 2026-05-18 — locked in
      // here so a careless edit to the deny-list (e.g. accidental
      // dedupe past zero) shows up as a test failure rather than a
      // silent regression where leftover events leak back into the UI.
      const expected = [
        'b8d38e654adff224418002ae752155a84a86dab6fa94b4bc9e81ca9e25dce9e7',
        '1251920ed2f86d0ff2e14d95a2dba42e5f0c23da6e766549ec28318fd2a6004c',
        '5a6f56679c4d6d6b0a6c0be95cb1bed7758c53b618420e3dda579a98e277c372',
        'b94b5013aa137c1ecddffaea073b279a0c7a7d1a350d30a6bded87d2068f5e97',
      ];
      for (const pk of expected) {
        expect(DEV_LEFTOVER_PUBKEYS.has(pk)).toBe(true);
      }
      expect(DEV_LEFTOVER_PUBKEYS.size).toBe(expected.length);
    });

    it("does NOT contain BIG Piggy's pubkey (active fixture)", () => {
      // BIG Piggy is the canonical test publisher — we want to *see*
      // its test events during dev, not filter them. If a refactor
      // moves BIG's nsec out of .env, the right fix is to revoke /
      // rotate the fixture, not to deny-list it.
      const BIG_PIGGY_PUBKEY = 'ccedbff9a6f261b388078b70225dfa4147efaab5f062a7722a0d253f0360c7e7';
      expect(DEV_LEFTOVER_PUBKEYS.has(BIG_PIGGY_PUBKEY)).toBe(false);
    });

    it('stores entries as lowercase hex (matches event.pubkey wire format)', () => {
      // nostr-tools yields lowercase-hex pubkeys at the subscribeMany /
      // querySync boundary. If we ever drift uppercase / mixed-case in
      // this file, the Set lookup would silently miss every match.
      for (const pk of DEV_LEFTOVER_PUBKEYS) {
        expect(pk).toMatch(/^[0-9a-f]{64}$/);
      }
    });
  });

  describe('isDevLeftover', () => {
    it('returns true for a known leftover pubkey', () => {
      expect(
        isDevLeftover('b8d38e654adff224418002ae752155a84a86dab6fa94b4bc9e81ca9e25dce9e7'),
      ).toBe(true);
    });

    it('returns false for BIG Piggy (active fixture)', () => {
      expect(
        isDevLeftover('ccedbff9a6f261b388078b70225dfa4147efaab5f062a7722a0d253f0360c7e7'),
      ).toBe(false);
    });

    it('returns false for an arbitrary unknown pubkey', () => {
      expect(
        isDevLeftover('0000000000000000000000000000000000000000000000000000000000000000'),
      ).toBe(false);
    });

    it('is case-sensitive (defensive — should never be called with non-lowercase)', () => {
      // Documents the invariant rather than masking it: uppercase
      // input from a future caller would silently fail to match and
      // leak events through. Cheaper to assert here than to surface
      // it as a UX regression months later.
      expect(
        isDevLeftover('B8D38E654ADFF224418002AE752155A84A86DAB6FA94B4BC9E81CA9E25DCE9E7'),
      ).toBe(false);
    });
  });
});
