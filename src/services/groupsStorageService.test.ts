/**
 * Coverage for the AsyncStorage-backed groups + group-activity store.
 * The schema-validation path on `loadGroupActivity` is the load-bearing
 * one — `formatConversationTimestamp` throws RangeError on a non-finite
 * lastActivityAt, so the cache MUST drop entries that fail the shape
 * check rather than passing them through.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createGroupId,
  loadGroupActivity,
  loadGroups,
  saveGroupActivity,
  saveGroups,
} from './groupsStorageService';
import type { Group, GroupActivity } from '../types/groups';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run before ESM imports are hoisted; require is the canonical form.
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const PUBKEY = 'a'.repeat(64);

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('createGroupId', () => {
  it('returns a string with the g_ prefix', () => {
    expect(createGroupId().startsWith('g_')).toBe(true);
  });

  it('returns distinct ids on successive calls', () => {
    const a = createGroupId();
    const b = createGroupId();
    expect(a).not.toBe(b);
  });
});

describe('loadGroups / saveGroups', () => {
  it('returns an empty array when nothing is stored', async () => {
    expect(await loadGroups()).toEqual([]);
  });

  it('round-trips a list of groups', async () => {
    const groups: Group[] = [
      {
        id: 'g_1',
        name: 'Test',
        memberPubkeys: ['x'],
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    await saveGroups(groups);
    expect(await loadGroups()).toEqual(groups);
  });

  it('returns an empty array when the persisted JSON is not an array', async () => {
    await AsyncStorage.setItem('nostr_groups', JSON.stringify({ wrong: 'shape' }));
    expect(await loadGroups()).toEqual([]);
  });

  it('returns an empty array when the persisted blob is invalid JSON', async () => {
    await AsyncStorage.setItem('nostr_groups', '{{{not json');
    expect(await loadGroups()).toEqual([]);
  });
});

describe('loadGroupActivity / saveGroupActivity', () => {
  function validActivity(): GroupActivity {
    return {
      lastActivityAt: 1234,
      lastText: 'hi',
      lastSenderPubkey: 'b'.repeat(64),
      recentSenderPubkeys: ['b'.repeat(64)],
    };
  }

  it('returns {} when nothing is stored for the pubkey', async () => {
    expect(await loadGroupActivity(PUBKEY)).toEqual({});
  });

  it('round-trips a valid activity map', async () => {
    const map: Record<string, GroupActivity> = { g1: validActivity() };
    await saveGroupActivity(PUBKEY, map);
    expect(await loadGroupActivity(PUBKEY)).toEqual(map);
  });

  it('drops entries whose lastActivityAt is not a finite number', async () => {
    // The shape guard exists specifically because
    // formatConversationTimestamp throws on a non-finite ts. A malformed
    // entry must be silently dropped rather than crashing the inbox on
    // mount.
    const stored = {
      g_good: validActivity(),
      g_nan: { ...validActivity(), lastActivityAt: NaN },
      g_str: { ...validActivity(), lastActivityAt: '123' },
      g_inf: { ...validActivity(), lastActivityAt: Infinity },
    };
    await AsyncStorage.setItem(`nostr_group_activity_${PUBKEY}`, JSON.stringify(stored));
    const loaded = await loadGroupActivity(PUBKEY);
    expect(Object.keys(loaded)).toEqual(['g_good']);
  });

  it('drops entries missing required fields', async () => {
    const stored = {
      // valid → keep
      g_good: validActivity(),
      // missing lastText
      g_no_text: {
        lastActivityAt: 1,
        lastSenderPubkey: null,
        recentSenderPubkeys: [],
      },
      // recentSenderPubkeys not an array
      g_no_arr: {
        lastActivityAt: 1,
        lastText: 'x',
        lastSenderPubkey: null,
        recentSenderPubkeys: 'nope',
      },
    };
    await AsyncStorage.setItem(`nostr_group_activity_${PUBKEY}`, JSON.stringify(stored));
    const loaded = await loadGroupActivity(PUBKEY);
    expect(Object.keys(loaded).sort()).toEqual(['g_good']);
  });

  it('returns {} when the persisted JSON is an array (wrong shape)', async () => {
    await AsyncStorage.setItem(`nostr_group_activity_${PUBKEY}`, JSON.stringify([1, 2, 3]));
    expect(await loadGroupActivity(PUBKEY)).toEqual({});
  });

  it('returns {} on invalid JSON', async () => {
    await AsyncStorage.setItem(`nostr_group_activity_${PUBKEY}`, '!!!');
    expect(await loadGroupActivity(PUBKEY)).toEqual({});
  });
});
