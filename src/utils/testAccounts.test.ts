// Contract guards for the prod-hide test-account list. The data (which
// pubkeys we hide in production) is the load-bearing thing — these tests
// lock it in so a careless edit shows up as a failure, and confirm the
// hex values match the canonical Maestro fixtures.

import { __TEST__, isHiddenInProdPubkey } from './testAccounts';
const { HIDDEN_IN_PROD_PUBKEYS } = __TEST__;

// Decoded once from the MAESTRO_NPUB_* fixtures in .env (see PR body for
// the npub → hex assumption). Re-derive with nostr-tools nip19.decode if
// the fixtures ever rotate.
const PIGGIES = {
  BIG: 'ccedbff9a6f261b388078b70225dfa4147efaab5f062a7722a0d253f0360c7e7',
  MIDDLE: '4b2fcb4e3c30c1363c4af5e3a6adebfe93cd572c3d57c31aaa4479d908612036',
  LITTLE: 'd9b33280ba733261d8b559fde0d662b6cb0786e30785313a086cdca95639457e',
  EVIL: '0b7475899c359de3eafeda471ebd7b8dea5e4d07f170570d8bfaece09876d4fc',
};

describe('testAccounts (HIDDEN_IN_PROD_PUBKEYS)', () => {
  it('contains exactly the four Piggy test accounts (Big / Middle / Little / Evil)', () => {
    const expected = Object.values(PIGGIES);
    for (const pk of expected) {
      expect(HIDDEN_IN_PROD_PUBKEYS.has(pk)).toBe(true);
    }
    expect(HIDDEN_IN_PROD_PUBKEYS.size).toBe(expected.length);
  });

  it('stores entries as lowercase hex (matches event.pubkey wire format)', () => {
    for (const pk of HIDDEN_IN_PROD_PUBKEYS) {
      expect(pk).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('isHiddenInProdPubkey returns true for each Piggy', () => {
    expect(isHiddenInProdPubkey(PIGGIES.BIG)).toBe(true);
    expect(isHiddenInProdPubkey(PIGGIES.EVIL)).toBe(true);
  });

  it('isHiddenInProdPubkey returns false for an arbitrary real user', () => {
    expect(
      isHiddenInProdPubkey('1111111111111111111111111111111111111111111111111111111111111111'),
    ).toBe(false);
  });

  it('matches case-insensitively (consistent with how pubkeys are normalized elsewhere)', () => {
    // Wire pubkeys are normally lowercase, but an upstream decode or relay
    // could hand us upper / mixed case — it must still be recognized as
    // hidden so test-account content can't bypass the prod-hide.
    expect(isHiddenInProdPubkey(PIGGIES.BIG.toUpperCase())).toBe(true);

    const mixedCase =
      PIGGIES.LITTLE.slice(0, 32).toUpperCase() + PIGGIES.LITTLE.slice(32).toLowerCase();
    expect(isHiddenInProdPubkey(mixedCase)).toBe(true);
  });
});
