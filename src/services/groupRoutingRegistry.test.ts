import {
  findGroupForParticipants,
  reconcileSyntheticGroup,
  setKnownGroups,
  setSyntheticGroupReconciler,
} from './groupRoutingRegistry';
import type { Group } from '../types/groups';

it('never routes an old account rumor through the active account registry', async () => {
  const group: Group = {
    id: 'shared',
    name: 'Family',
    memberPubkeys: ['partner'],
    createdAt: 1,
    updatedAt: 1,
  };
  const reconcile = jest.fn(async () => group);
  setKnownGroups([group], 'b');
  setSyntheticGroupReconciler(reconcile, 'b');
  expect(findGroupForParticipants(new Set(['partner']), 'a')).toBeNull();
  expect(findGroupForParticipants(new Set(['partner']), 'b')).toEqual(group);
  const input = { groupId: 'shared', name: 'Family', memberPubkeys: ['partner'], createdAtSec: 1 };
  expect(await reconcileSyntheticGroup(input, 'a')).toBeNull();
  expect(reconcile).not.toHaveBeenCalled();
  expect(await reconcileSyntheticGroup(input, 'b')).toEqual(group);
  setKnownGroups([]);
  setSyntheticGroupReconciler(null);
});

it.each([false, true])(
  'publishes a reconciled room before returning only while its owner is current (switched=%s)',
  async (switched) => {
    const group: Group = {
      id: 'new-room',
      name: 'Family',
      memberPubkeys: ['partner'],
      createdAt: 1,
      updatedAt: 1,
    };
    let finish!: (group: Group) => void;
    setKnownGroups([], 'a');
    setSyntheticGroupReconciler(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      'a',
    );
    const pending = reconcileSyntheticGroup(
      { groupId: group.id, name: group.name, memberPubkeys: ['partner'], createdAtSec: 1 },
      'a',
    );
    if (switched) {
      setKnownGroups([], 'b');
      setSyntheticGroupReconciler(async () => null, 'b');
    }
    finish(group);
    await pending;
    expect(findGroupForParticipants(new Set(['partner']), switched ? 'b' : 'a')).toEqual(
      switched ? null : group,
    );
    setKnownGroups([]);
    setSyntheticGroupReconciler(null);
  },
);
