// Unit tests for the FoF heuristics from issue #535. Targets the pure
// `buildFofSet` core so we don't need to stub fetchKind3 / AsyncStorage.

import { buildFofSet, FANOUT_CAP } from './friendsOfFriendsService';

// Build a 64-char hex-shaped synthetic pubkey. We mix the label + index
// into the suffix (not the prefix) so the padding always sits between
// them and short numeric prefixes can't get clipped off by slice().
const pk = (label: string, n: number): string => {
  const tail = `${label}_${n}`;
  // Pad on the *left* with zeros so the index always survives in full.
  return tail.padStart(64, '0').slice(-64);
};

// Helper: generate N synthetic pubkey-like strings sharing a label prefix
// so they're easy to eyeball in failures.
const gen = (label: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => pk(label, i));

describe('friendsOfFriendsService — heuristics from #535', () => {
  const user = pk('u', 0);
  const friendA = pk('a', 0);
  const friendB = pk('b', 0);

  describe('heuristic 1: exclude friends with > 500 follows', () => {
    it('excludes a friend with 501 follows', () => {
      const friendAList = gen('x', 501);
      const friendBList = gen('y', 100);
      const { set, excludedFriends } = buildFofSet(user, [friendA, friendB], {
        [friendA]: friendAList,
        [friendB]: friendBList,
      });
      // friendA contributed nothing. friendB's 100 follows are all in.
      for (const p of friendAList) expect(set.has(p)).toBe(false);
      for (const p of friendBList) expect(set.has(p)).toBe(true);
      expect(excludedFriends).toBe(1);
    });

    it('includes a friend with exactly 500 follows', () => {
      const friendAList = gen('x', FANOUT_CAP);
      const { set, excludedFriends } = buildFofSet(user, [friendA], {
        [friendA]: friendAList,
      });
      expect(set.size).toBe(FANOUT_CAP);
      expect(excludedFriends).toBe(0);
    });
  });

  describe('heuristic 2: cap each contributing friend at 500 follows', () => {
    it('contributes exactly 500 entries from a friend with 700 follows', () => {
      // Friend has 700 follows — over cap, so heuristic 1 would *exclude*
      // them entirely. To test the cap-at-500 path, pair them with a
      // batch of under-cap friends so the soft-cap fallback fires and
      // heuristic 1 is dropped (then heuristic 2 still slices to 500).
      // To isolate heuristic 2, force the soft-cap fallback by making
      // >50 % of friends over-cap. With heuristic 1 dropped each heavy
      // friend's slice (max FANOUT_CAP) is what we measure.
      // Use distinct, case-folded prefixes for friends vs follow-list entries
      // so the lowercase normalisation in buildFofSet doesn't accidentally
      // collide a follow-list pubkey back onto the friend set.
      const heavies = Array.from({ length: 6 }, (_, i) => pk(`hv${i}`, 0));
      const lists: Record<string, string[]> = {};
      heavies.forEach((h, i) => {
        // Each over-cap friend gets a distinct set of 700 follows.
        lists[h] = gen(`zz${i}`, 700);
      });
      const lights = Array.from({ length: 4 }, (_, i) => pk(`lt${i}`, 0));
      lights.forEach((l, i) => {
        lists[l] = gen(`ll${i}`, 10);
      });
      const friends = [...heavies, ...lights];
      // 6 / 10 = 60 % over cap → applying heuristic 1 leaves 40 % contributing,
      // which is < 50 % → soft-cap fallback kicks in → heuristic 1 dropped.
      const { set, excludedFriends } = buildFofSet(user, friends, lists);
      expect(excludedFriends).toBe(0); // soft-cap fallback dropped the exclusion
      // Heavy friends each contribute exactly FANOUT_CAP. Distinct prefixes
      // mean no collisions across heavy lists. + lights contribute 4 × 10 = 40.
      expect(set.size).toBe(6 * FANOUT_CAP + 4 * 10);
      // Spot-check: the 501st entry of a heavy list is NOT in the set.
      expect(set.has(lists[heavies[0]][FANOUT_CAP])).toBe(false);
      // Spot-check: the 500th entry (index 499) IS in the set.
      expect(set.has(lists[heavies[0]][FANOUT_CAP - 1])).toBe(true);
    });
  });

  describe('soft-cap fallback (heuristic 3)', () => {
    it('drops the high-fanout exclusion when it would leave < 50 % contributing', () => {
      // 5 friends, 3 over cap → only 40 % would contribute → soft-cap kicks in.
      // Distinct prefixes for friends vs follow-list entries so the
      // lowercase normalisation in buildFofSet doesn't collide them.
      const friends = [pk('fa', 0), pk('fb', 0), pk('fc', 0), pk('fd', 0), pk('fe', 0)];
      const lists: Record<string, string[]> = {
        [friends[0]]: gen('la', 600), // over cap
        [friends[1]]: gen('lb', 600), // over cap
        [friends[2]]: gen('lc', 600), // over cap
        [friends[3]]: gen('ld', 10),
        [friends[4]]: gen('le', 10),
      };
      const { set, excludedFriends } = buildFofSet(user, friends, lists);
      expect(excludedFriends).toBe(0);
      // All 3 over-cap friends contribute FANOUT_CAP each + 2 light friends contribute 10 each.
      expect(set.size).toBe(3 * FANOUT_CAP + 2 * 10);
    });

    it('keeps the exclusion when ≥ 50 % of friends still contribute', () => {
      // 10 friends, 2 over cap → 8 / 10 = 80 % contributing → keep exclusion
      const friends = Array.from({ length: 10 }, (_, i) => pk(`f${i}`, 0));
      const lists: Record<string, string[]> = {};
      friends.forEach((f, i) => {
        lists[f] = i < 2 ? gen(`O${i}`, 600) : gen(`U${i}`, 5);
      });
      const { excludedFriends } = buildFofSet(user, friends, lists);
      expect(excludedFriends).toBe(2);
    });
  });

  describe('dedup', () => {
    it('deduplicates the same pubkey appearing across multiple friends', () => {
      const shared = pk('s', 0);
      const lists: Record<string, string[]> = {
        [friendA]: [shared, pk('x', 1), pk('x', 2)],
        [friendB]: [shared, pk('y', 1), pk('y', 2)],
      };
      const { set } = buildFofSet(user, [friendA, friendB], lists);
      expect(set.has(shared)).toBe(true);
      // 1 shared + 2 unique from A + 2 unique from B = 5 entries.
      expect(set.size).toBe(5);
    });
  });

  describe('user + direct friends are excluded from FoF set', () => {
    it('does not include the user pubkey', () => {
      const lists: Record<string, string[]> = {
        [friendA]: [user, pk('x', 1)],
      };
      const { set } = buildFofSet(user, [friendA], lists);
      expect(set.has(user)).toBe(false);
      expect(set.has(pk('x', 1))).toBe(true);
    });

    it('does not include direct friends (they pass via the Friends tier already)', () => {
      const lists: Record<string, string[]> = {
        [friendA]: [friendB, pk('z', 1)],
        [friendB]: [friendA, pk('z', 2)],
      };
      const { set } = buildFofSet(user, [friendA, friendB], lists);
      expect(set.has(friendA)).toBe(false);
      expect(set.has(friendB)).toBe(false);
      expect(set.has(pk('z', 1))).toBe(true);
      expect(set.has(pk('z', 2))).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns empty set when user has no follows', () => {
      const { set, excludedFriends } = buildFofSet(user, [], {});
      expect(set.size).toBe(0);
      expect(excludedFriends).toBe(0);
    });

    it('tolerates missing kind-3 data for a friend (counts them as 0 follows)', () => {
      const lists: Record<string, string[]> = {
        [friendA]: [pk('x', 1)],
        // friendB has no entry — kind-3 not yet fetched
      };
      const { set, excludedFriends } = buildFofSet(user, [friendA, friendB], lists);
      expect(set.has(pk('x', 1))).toBe(true);
      expect(excludedFriends).toBe(0);
    });
  });

  // Additional coverage scenarios (PR #536 hardening): each scenario
  // exercises a specific boundary in the heuristic logic so a future
  // refactor that breaks one of them surfaces immediately rather than
  // leaking through to relay-fetch integration tests.
  describe('PR #536 hardening: additional scenarios', () => {
    it('soft-cap fallback with mixed fanout — 3-of-4 heavy → fallback kicks in, heuristic 2 still slices', () => {
      // 4 friends. 3 follow 600 each (over cap), 1 follows 100.
      // Without fallback: only 1 friend contributes (25 %) → fallback fires.
      // With fallback: all 4 contribute, but heuristic 2 still slices the
      // heavies to FANOUT_CAP entries each. Distinct prefixes per heavy
      // mean their slices never collide, so the union is
      //   3 × FANOUT_CAP   (heavy contributions)
      // + 100              (light contribution)
      // unique pubkeys.
      const heavy = Array.from({ length: 3 }, (_, i) => pk(`heavy${i}`, 0));
      const light = pk('light', 0);
      const lists: Record<string, string[]> = {
        [heavy[0]]: gen('hh0', 600),
        [heavy[1]]: gen('hh1', 600),
        [heavy[2]]: gen('hh2', 600),
        [light]: gen('ll', 100),
      };
      const { set, excludedFriends } = buildFofSet(user, [...heavy, light], lists);
      expect(excludedFriends).toBe(0);
      expect(set.size).toBe(3 * FANOUT_CAP + 100);
      // Heuristic 2 still applied: 501st entry of each heavy must NOT be in.
      for (const h of heavy) expect(set.has(lists[h][FANOUT_CAP])).toBe(false);
    });

    it("single-friend graph — FoF set is exactly that friend's follows minus the user's own", () => {
      const onlyFriend = pk('only', 0);
      const friendFollows = gen('ff', 200);
      const { set, excludedFriends } = buildFofSet(user, [onlyFriend], {
        [onlyFriend]: friendFollows,
      });
      // None of the friend's follows overlap user / friend, so all 200 land.
      expect(set.size).toBe(200);
      expect(excludedFriends).toBe(0);
      for (const p of friendFollows) expect(set.has(p)).toBe(true);
    });

    it('empty contact graph — FoF set is empty, excludedFriends = 0', () => {
      const { set, excludedFriends } = buildFofSet(user, [], {});
      expect(set.size).toBe(0);
      expect(excludedFriends).toBe(0);
    });

    it("self-exclusion — the user's own pubkey is never in the FoF set", () => {
      // Friend's follow list includes the user. Buried mid-list so we
      // exercise the loop rather than a first-element shortcut.
      const friendList = [pk('x', 1), user, pk('x', 2), pk('x', 3)];
      const { set } = buildFofSet(user, [friendA], { [friendA]: friendList });
      expect(set.has(user)).toBe(false);
      // Sanity: the other three followees are present.
      expect(set.size).toBe(3);
    });

    it('cross-presence dedup — two friends both follow the same third party → appears once', () => {
      const shared = pk('shared', 0);
      const lists: Record<string, string[]> = {
        [friendA]: [shared, pk('a1', 0), pk('a2', 0)],
        [friendB]: [shared, pk('b1', 0), pk('b2', 0)],
      };
      const { set } = buildFofSet(user, [friendA, friendB], lists);
      // Count the shared pubkey by enumeration — Set inherently dedups
      // but we want an explicit assertion in case the implementation
      // accidentally switches to an array.
      let occurrences = 0;
      for (const p of set) if (p === shared) occurrences += 1;
      expect(occurrences).toBe(1);
      // Total: 1 shared + 2 unique-A + 2 unique-B = 5.
      expect(set.size).toBe(5);
    });
  });
});
