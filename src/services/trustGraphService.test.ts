import { DEFAULT_SEED_PUBKEYS, computeTrustSet, isPubkeyTrusted } from './trustGraphService';

describe('trustGraphService', () => {
  const userPk = 'a'.repeat(64);
  const friend = 'b'.repeat(64);
  const stranger = 'c'.repeat(64);

  describe('computeTrustSet', () => {
    it('always includes the user pubkey', () => {
      const set = computeTrustSet(userPk, new Set());
      expect(set.has(userPk)).toBe(true);
    });

    it('includes follows + default seeds', () => {
      const set = computeTrustSet(userPk, new Set([friend]));
      expect(set.has(friend)).toBe(true);
      for (const seed of DEFAULT_SEED_PUBKEYS) {
        expect(set.has(seed)).toBe(true);
      }
    });

    it('excludes default seeds when includeSeeds=false', () => {
      const set = computeTrustSet(userPk, new Set([friend]), new Set(), false);
      for (const seed of DEFAULT_SEED_PUBKEYS) {
        expect(set.has(seed)).toBe(false);
      }
    });

    it('includes L2 friends-of-follows', () => {
      const friendOfFriend = 'd'.repeat(64);
      const set = computeTrustSet(userPk, new Set([friend]), new Set([friendOfFriend]));
      expect(set.has(friendOfFriend)).toBe(true);
    });

    it('handles a logged-out user', () => {
      const set = computeTrustSet(null, new Set([friend]));
      expect(set.has(friend)).toBe(true);
      // No user pubkey to add; just follows + seeds.
      expect(set.size).toBe(1 + DEFAULT_SEED_PUBKEYS.length);
    });

    it('normalises everything to lowercase', () => {
      // Mixed-case input should round-trip to lowercase membership.
      const upperFriend = friend.toUpperCase();
      const set = computeTrustSet(userPk.toUpperCase(), new Set([upperFriend]));
      expect(set.has(userPk)).toBe(true);
      expect(set.has(friend)).toBe(true);
    });
  });

  describe('isPubkeyTrusted', () => {
    it('returns true for a follow, false for a stranger', () => {
      const set = computeTrustSet(userPk, new Set([friend]), new Set(), false);
      expect(isPubkeyTrusted(friend, set)).toBe(true);
      expect(isPubkeyTrusted(stranger, set)).toBe(false);
    });

    it('is case-insensitive on the candidate pubkey', () => {
      const set = computeTrustSet(userPk, new Set([friend]), new Set(), false);
      expect(isPubkeyTrusted(friend.toUpperCase(), set)).toBe(true);
    });

    it('treats a default seed as trusted', () => {
      const set = computeTrustSet(userPk, new Set());
      expect(isPubkeyTrusted(DEFAULT_SEED_PUBKEYS[0], set)).toBe(true);
    });
  });
});
