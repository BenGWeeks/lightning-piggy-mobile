/**
 * Coverage for the in-memory group registry that NostrContext consults
 * during NIP-17 decrypt to route inbound kind-14 rumors to the right
 * local thread. Resets module state between tests so registrations
 * from one case can't leak into another.
 */

import {
  findGroupForParticipants,
  getKnownGroups,
  reconcileSyntheticGroup,
  setKnownGroups,
  setSyntheticGroupReconciler,
  type SyntheticRoomInput,
} from './groupRoutingRegistry';
import type { Group } from '../types/groups';

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);
const PK_C = 'c'.repeat(64);

function makeGroup(id: string, members: string[]): Group {
  return {
    id,
    name: `Group ${id}`,
    memberPubkeys: members,
    createdAt: 0,
    updatedAt: 0,
  };
}

beforeEach(() => {
  // Reset shared module state so each test starts from a clean slate.
  setKnownGroups([]);
  setSyntheticGroupReconciler(null);
});

describe('setKnownGroups / getKnownGroups', () => {
  it('starts empty', () => {
    expect(getKnownGroups()).toEqual([]);
  });

  it('replaces the registered list on each set', () => {
    setKnownGroups([makeGroup('g1', [PK_A])]);
    setKnownGroups([makeGroup('g2', [PK_B])]);
    const known = getKnownGroups();
    expect(known).toHaveLength(1);
    expect(known[0].id).toBe('g2');
  });
});

describe('findGroupForParticipants', () => {
  it('returns null when nothing is registered', () => {
    expect(findGroupForParticipants(new Set([PK_A, PK_B]))).toBeNull();
  });

  it('matches a group whose member set equals the participant set', () => {
    const g = makeGroup('g1', [PK_A, PK_B]);
    setKnownGroups([g]);
    const hit = findGroupForParticipants(new Set([PK_A, PK_B]));
    expect(hit).toBe(g);
  });

  it('normalises stored member pubkeys to lowercase before comparing', () => {
    // findGroupForParticipants compares `pk.toLowerCase()` (stored
    // member) against the participant set as-is, so the case-folding
    // it actually performs is on the stored side. Register the group
    // with uppercase members and look up with lowercase to exercise
    // that branch — using `.toUpperCase().toLowerCase()` on both
    // sides (as the test used to) just folds back to lowercase before
    // the call and never reaches the normalisation code path.
    const g = makeGroup('g1', [PK_A.toUpperCase(), PK_B.toUpperCase()]);
    setKnownGroups([g]);
    const hit = findGroupForParticipants(new Set([PK_A, PK_B]));
    expect(hit).toBe(g);
  });

  it('rejects partial overlaps (different size)', () => {
    setKnownGroups([makeGroup('g1', [PK_A, PK_B])]);
    expect(findGroupForParticipants(new Set([PK_A]))).toBeNull();
    expect(findGroupForParticipants(new Set([PK_A, PK_B, PK_C]))).toBeNull();
  });

  it('rejects same-size sets that disagree on at least one member', () => {
    setKnownGroups([makeGroup('g1', [PK_A, PK_B])]);
    expect(findGroupForParticipants(new Set([PK_A, PK_C]))).toBeNull();
  });
});

describe('reconcileSyntheticGroup', () => {
  it('returns null when no reconciler is registered', async () => {
    const out = await reconcileSyntheticGroup({
      groupId: 's_test',
      name: 'x',
      memberPubkeys: [PK_A],
      createdAtSec: 0,
    });
    expect(out).toBeNull();
  });

  it('forwards the input to the registered reconciler and returns its result', async () => {
    const expected = makeGroup('s_test', [PK_A]);
    const calls: SyntheticRoomInput[] = [];
    setSyntheticGroupReconciler(async (input) => {
      calls.push(input);
      return expected;
    });
    const input: SyntheticRoomInput = {
      groupId: 's_test',
      name: 'Cross-client room',
      memberPubkeys: [PK_A],
      createdAtSec: 1234,
    };
    const out = await reconcileSyntheticGroup(input);
    expect(out).toBe(expected);
    expect(calls).toEqual([input]);
  });

  it('clears the reconciler when set back to null', async () => {
    setSyntheticGroupReconciler(async () => makeGroup('s_test', [PK_A]));
    setSyntheticGroupReconciler(null);
    const out = await reconcileSyntheticGroup({
      groupId: 's_test',
      name: 'x',
      memberPubkeys: [PK_A],
      createdAtSec: 0,
    });
    expect(out).toBeNull();
  });
});
