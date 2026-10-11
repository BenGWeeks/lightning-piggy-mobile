// No-loss migration of legacy device-wide group logs to per-account keys
// (#1240). The rejected first attempt re-keyed storage and stopped reading
// the legacy blobs, silently dropping everyone's (unrecoverable) Marmot
// history — these tests pin that nothing is lost on the way over.

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  GROUP_ACTIVITY_RESET_KEY,
  releaseLegacyGroupLogs,
  mergeGroupLogs,
  resetGroupMessagesMigrationForTests,
  runGroupMessagesMigration,
  type GroupMessagesMigrationDeps,
} from './groupMessagesMigration';
import { groupMessagesKey, legacyGroupMessagesKey } from './groupMessagesKeys';
import { loadGroupMessages, type GroupMessage } from './groupMessagesStorageService';
import { loadGroupActivity } from './groupsStorageService';
import { syntheticGroupIdForParticipants } from '../utils/syntheticGroupId';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// The DB-backed default lookup, for paths that run the real gate.
const mockMarmotOwners = jest.fn(async (_mls: string): Promise<string[]> => []);
jest.mock('./marmotStore', () => ({
  listMarmotOwnersForGroup: (mls: string) => mockMarmotOwners(mls),
}));

const PARENT = '1'.repeat(64);
const CHILD = '2'.repeat(64);
const OTHER = '3'.repeat(64);
const MLS = 'abcdef0123';
const MARMOT_GROUP = `marmot:${MLS}`;

const msg = (id: string, createdAt: number, text = id): GroupMessage => ({
  id,
  senderPubkey: OTHER,
  text,
  createdAt,
});

let warnSpy: jest.SpyInstance;

const noMarmot: Partial<GroupMessagesMigrationDeps> = {
  marmotOwners: async () => [],
  registeredAccounts: async () => [],
};

async function seedLegacy(groupId: string, log: GroupMessage[]): Promise<void> {
  await AsyncStorage.setItem(legacyGroupMessagesKey(groupId), JSON.stringify(log));
}

async function seedGroupList(owner: string, groupIds: string[]): Promise<void> {
  await AsyncStorage.setItem(
    `nostr_groups_${owner}`,
    JSON.stringify(groupIds.map((id) => ({ id, name: id, memberPubkeys: [] }))),
  );
}

async function readOwned(owner: string, groupId: string): Promise<GroupMessage[] | null> {
  const raw = await AsyncStorage.getItem(groupMessagesKey(owner, groupId));
  return raw === null ? null : (JSON.parse(raw) as GroupMessage[]);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetGroupMessagesMigrationForTests();
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

// Restore only this spy — the async-storage mock's own jest.fns must keep
// their implementations (see groupMessagesStorageService.test.ts).
afterEach(() => warnSpy.mockRestore());

describe('runGroupMessagesMigration', () => {
  it('copies a shared legacy blob to EVERY owner listing the group, then deletes it', async () => {
    const log = [msg('m1', 1), msg('m2', 2)];
    await seedLegacy('g_room', log);
    await seedGroupList(PARENT, ['g_room', 'g_other']);
    await seedGroupList(CHILD, ['g_room']);

    const result = await runGroupMessagesMigration(noMarmot);

    expect(result.migrated).toEqual({ g_room: [PARENT, CHILD].sort() });
    expect(await readOwned(PARENT, 'g_room')).toEqual(log);
    expect(await readOwned(CHILD, 'g_room')).toEqual(log);
    expect(await AsyncStorage.getItem(legacyGroupMessagesKey('g_room'))).toBeNull();
  });

  it('attributes Marmot blobs from the encrypted Marmot state (read-only lookup)', async () => {
    const log = [msg('m1', 1)];
    await seedLegacy(MARMOT_GROUP, log);
    const marmotOwners = jest.fn(async () => [PARENT.toUpperCase()]);

    const result = await runGroupMessagesMigration({ marmotOwners });

    expect(marmotOwners).toHaveBeenCalledWith(MLS);
    expect(result.migrated).toEqual({ [MARMOT_GROUP]: [PARENT] });
    expect(await readOwned(PARENT, MARMOT_GROUP)).toEqual(log);
    expect(await readOwned(CHILD, MARMOT_GROUP)).toBeNull();
  });

  it('does NOT treat an activity rollup as ownership (pre-#1214 rollups leaked across accounts)', async () => {
    await seedLegacy(MARMOT_GROUP, [msg('m1', 1)]);
    // The child's rollup is a stale copy of the parent's — the real device
    // state this PR was validated against.
    await AsyncStorage.setItem(
      `nostr_group_activity_${CHILD}`,
      JSON.stringify({ [MARMOT_GROUP]: { lastActivityAt: 1 } }),
    );

    const result = await runGroupMessagesMigration({ marmotOwners: async () => [PARENT] });

    expect(result.migrated[MARMOT_GROUP]).toEqual([PARENT]);
    expect(await readOwned(CHILD, MARMOT_GROUP)).toBeNull();
  });

  it('keeps a blob no account owns on disk, and never shows it', async () => {
    const log = [msg('m1', 1)];
    await seedLegacy('g_orphan', log);
    await seedGroupList(PARENT, ['g_mine']);

    const result = await runGroupMessagesMigration(noMarmot);

    expect(result.unowned).toEqual(['g_orphan']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('1 unowned'));
    expect(JSON.parse((await AsyncStorage.getItem(legacyGroupMessagesKey('g_orphan')))!)).toEqual(
      log,
    );
    expect(await readOwned(PARENT, 'g_orphan')).toBeNull();
  });

  it('adopts a kept blob on a later run once an account owns the group', async () => {
    await seedLegacy('g_orphan', [msg('m1', 1)]);
    await runGroupMessagesMigration(noMarmot);
    await seedGroupList(CHILD, ['g_orphan']);

    const result = await runGroupMessagesMigration(noMarmot);

    expect(result.migrated).toEqual({ g_orphan: [CHILD] });
    expect(await readOwned(CHILD, 'g_orphan')).toEqual([msg('m1', 1)]);
  });

  it('defers (keeps) a Marmot blob when the owner lookup fails', async () => {
    await seedLegacy(MARMOT_GROUP, [msg('m1', 1)]);
    await seedGroupList(PARENT, [MARMOT_GROUP]);

    const result = await runGroupMessagesMigration({
      marmotOwners: async () => {
        throw new Error('db locked');
      },
    });

    expect(result.deferred).toEqual([MARMOT_GROUP]);
    expect(await AsyncStorage.getItem(legacyGroupMessagesKey(MARMOT_GROUP))).not.toBeNull();
    expect(await readOwned(PARENT, MARMOT_GROUP)).toBeNull();
  });

  it('keeps a corrupt legacy blob rather than deleting it', async () => {
    await AsyncStorage.setItem(legacyGroupMessagesKey('g_bad'), '{not json');
    await seedGroupList(PARENT, ['g_bad']);

    const result = await runGroupMessagesMigration(noMarmot);

    expect(result.unowned).toEqual(['g_bad']);
    expect(await AsyncStorage.getItem(legacyGroupMessagesKey('g_bad'))).toBe('{not json');
  });

  it('merges into an existing per-account log instead of overwriting it', async () => {
    await seedLegacy('g_1', [msg('old', 1), msg('both', 2, 'legacy copy')]);
    await AsyncStorage.setItem(
      groupMessagesKey(PARENT, 'g_1'),
      JSON.stringify([msg('both', 2, 'owned copy'), msg('new', 3)]),
    );
    await seedGroupList(PARENT, ['g_1']);

    await runGroupMessagesMigration(noMarmot);

    const merged = await readOwned(PARENT, 'g_1');
    expect(merged?.map((m) => m.id)).toEqual(['old', 'both', 'new']);
    // Same id + same createdAt: the row already in the owned log wins.
    expect(merged?.find((m) => m.id === 'both')?.text).toBe('owned copy');
  });

  it('is idempotent: a second run changes nothing', async () => {
    await seedLegacy('g_1', [msg('m1', 1)]);
    await seedGroupList(PARENT, ['g_1']);
    await runGroupMessagesMigration(noMarmot);
    const snapshot = await AsyncStorage.multiGet(await AsyncStorage.getAllKeys());

    const second = await runGroupMessagesMigration(noMarmot);

    expect(second).toEqual({ migrated: {}, unowned: [], deferred: [], resetActivity: 0 });
    expect(await AsyncStorage.multiGet(await AsyncStorage.getAllKeys())).toEqual(snapshot);
  });

  it('survives an interruption mid-copy: legacy kept, re-run completes every owner', async () => {
    const log = [msg('m1', 1), msg('m2', 2)];
    await seedLegacy('g_1', log);
    await seedGroupList(PARENT, ['g_1']);
    await seedGroupList(CHILD, ['g_1']);
    // "Crash" on the second owner's copy (PARENT's lands first — sorted).
    const setItem = AsyncStorage.setItem as jest.Mock;
    const real = setItem.getMockImplementation()!;
    let killed = false;
    setItem.mockImplementation(async (k: string, v: string) => {
      if (!killed && k === groupMessagesKey(CHILD, 'g_1')) {
        killed = true;
        throw new Error('process killed');
      }
      return real(k, v);
    });
    try {
      await expect(runGroupMessagesMigration(noMarmot)).rejects.toThrow('process killed');
    } finally {
      setItem.mockImplementation(real);
    }
    expect(await AsyncStorage.getItem(legacyGroupMessagesKey('g_1'))).not.toBeNull();
    expect(await readOwned(PARENT, 'g_1')).toEqual(log);
    expect(await readOwned(CHILD, 'g_1')).toBeNull();

    await runGroupMessagesMigration(noMarmot);

    expect(await readOwned(PARENT, 'g_1')).toEqual(log); // no duplicates
    expect(await readOwned(CHILD, 'g_1')).toEqual(log);
    expect(await AsyncStorage.getItem(legacyGroupMessagesKey('g_1'))).toBeNull();
  });

  it('never treats an already per-account key as legacy', async () => {
    await AsyncStorage.setItem(groupMessagesKey(PARENT, MARMOT_GROUP), JSON.stringify([]));
    const marmotOwners = jest.fn(async () => [CHILD]);

    const result = await runGroupMessagesMigration({ marmotOwners });

    expect(marmotOwners).not.toHaveBeenCalled();
    expect(result).toEqual({ migrated: {}, unowned: [], deferred: [], resetActivity: 0 });
  });
});

describe('one-time reset of activity rollups', () => {
  const entry = (text: string) => ({
    lastActivityAt: 1,
    lastText: text,
    lastSenderPubkey: null,
    recentSenderPubkeys: [],
  });

  it('deletes every rollup once (they may hold previews leaked from other accounts)', async () => {
    await AsyncStorage.setItem(
      `nostr_group_activity_${CHILD}`,
      JSON.stringify({ g_parent: entry("parent's plaintext") }),
    );
    await AsyncStorage.setItem(`nostr_group_activity_${PARENT}`, JSON.stringify({}));

    const result = await runGroupMessagesMigration(noMarmot);

    expect(result.resetActivity).toBe(2);
    expect(await AsyncStorage.getItem(`nostr_group_activity_${CHILD}`)).toBeNull();
    expect(await AsyncStorage.getItem(GROUP_ACTIVITY_RESET_KEY)).toBe('1');
  });

  it('runs once: a rollup rebuilt afterwards is kept', async () => {
    await runGroupMessagesMigration(noMarmot);
    await AsyncStorage.setItem(`nostr_group_activity_${CHILD}`, JSON.stringify({ g: entry('x') }));

    expect((await runGroupMessagesMigration(noMarmot)).resetActivity).toBe(0);
    expect(await AsyncStorage.getItem(`nostr_group_activity_${CHILD}`)).not.toBeNull();
  });

  it('loadGroupActivity never hydrates a pre-reset rollup', async () => {
    await AsyncStorage.setItem(
      `nostr_group_activity_${CHILD}`,
      JSON.stringify({ g_parent: entry("parent's plaintext") }),
    );
    expect(await loadGroupActivity(CHILD)).toEqual({});
    expect(await AsyncStorage.getItem(`nostr_group_activity_${CHILD}`)).toBeNull();
  });
});

describe('synthetic NIP-17 rooms: membership check on saved lists (#1240 review)', () => {
  const LITTLE = '4'.repeat(64);
  const room = syntheticGroupIdForParticipants([PARENT, CHILD, LITTLE]);
  const listWith = (owner: string, members: string[]) =>
    AsyncStorage.setItem(
      `nostr_groups_${owner}`,
      JSON.stringify([{ id: room, memberPubkeys: members }]),
    );

  it('copies to an account whose own list entry re-derives the room id', async () => {
    await seedLegacy(room, [msg('m1', 1)]);
    await listWith(PARENT, [CHILD, LITTLE]); // members exclude the viewer
    await listWith(CHILD, [PARENT, LITTLE]);

    expect((await runGroupMessagesMigration(noMarmot)).migrated[room]).toEqual(
      [PARENT, CHILD].sort(),
    );
  });

  it("ignores an entry leaked from another account's list (pre-#1214)", async () => {
    const parentOnly = syntheticGroupIdForParticipants([PARENT, LITTLE, OTHER]);
    await seedLegacy(parentOnly, [msg('m1', 1)]);
    // CHILD's list holds the parent's entry verbatim: members = parent's view.
    await AsyncStorage.setItem(
      `nostr_groups_${CHILD}`,
      JSON.stringify([{ id: parentOnly, memberPubkeys: [LITTLE, OTHER] }]),
    );

    const result = await runGroupMessagesMigration(noMarmot);

    expect(result.unowned).toEqual([parentOnly]);
    expect(await readOwned(CHILD, parentOnly)).toBeNull();
  });
});

describe('releaseLegacyGroupLogs — sign-out cleanup (#689, #1240 review)', () => {
  it('deletes blobs nobody can claim, copies newly-owned ones, keeps nothing behind', async () => {
    await seedLegacy('g_orphan', [msg('m1', 1)]); // no owner
    await seedLegacy('g_bad', []);
    await AsyncStorage.setItem(legacyGroupMessagesKey('g_bad'), '{corrupt');
    await seedGroupList(CHILD, ['g_bad']);

    const r = await releaseLegacyGroupLogs(CHILD, {
      ...noMarmot,
      registeredAccounts: async () => [],
    });

    expect(r.deleted.sort()).toEqual(['g_bad', 'g_orphan']);
    const left = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('group_messages_'));
    expect(left).toEqual([]);
  });

  it('keeps a deferred Marmot blob while another account remains, deletes it when none does', async () => {
    await seedLegacy(MARMOT_GROUP, [msg('m1', 1)]);
    const failing = async () => {
      throw new Error('db locked');
    };

    const withOther = await releaseLegacyGroupLogs(CHILD, {
      marmotOwners: failing,
      registeredAccounts: async () => [CHILD, PARENT],
    });
    expect(withOther.kept).toEqual([MARMOT_GROUP]);

    const lastOne = await releaseLegacyGroupLogs(CHILD, {
      marmotOwners: failing,
      registeredAccounts: async () => [CHILD],
    });
    expect(lastOne.deleted).toEqual([MARMOT_GROUP]);
    expect(await AsyncStorage.getItem(legacyGroupMessagesKey(MARMOT_GROUP))).toBeNull();
  });

  it("counts an unregistered (NIP-46) account's group data as another account", async () => {
    await seedLegacy(MARMOT_GROUP, [msg('m1', 1)]);
    await AsyncStorage.setItem(groupMessagesKey(OTHER, 'g_x'), '[]');

    const r = await releaseLegacyGroupLogs(CHILD, {
      marmotOwners: async () => {
        throw new Error('db locked');
      },
      registeredAccounts: async () => [CHILD],
    });

    expect(r.kept).toEqual([MARMOT_GROUP]);
  });
});

describe('mergeGroupLogs', () => {
  it('never truncates: a full legacy blob plus owned rows keeps every message', () => {
    const legacy = Array.from({ length: 500 }, (_, i) => msg(`a${i}`, i));
    const merged = mergeGroupLogs([msg('newest', 501)], legacy);
    expect(merged).toHaveLength(501);
    expect(merged[0].id).toBe('a0');
    expect(merged[merged.length - 1].id).toBe('newest');
  });

  it('keeps the edited copy of a message whichever log holds it (#1227)', () => {
    const edited = { ...msg('m1', 1), text: 'v2', editedAt: 5, editId: 'e' };
    expect(mergeGroupLogs([msg('m1', 1)], [edited])).toEqual([edited]);
    expect(mergeGroupLogs([edited], [msg('m1', 1)])).toEqual([edited]);
  });
});

describe('crafted group ids (#1240 review)', () => {
  it("a legacy id shaped like '<pubkey>:g_room' is migrated as an ordinary group, never read as that account's history", async () => {
    const crafted = `${PARENT}:g_room`;
    await seedLegacy(crafted, [msg('child-only', 1)]);
    await seedGroupList(CHILD, [crafted]);

    const result = await runGroupMessagesMigration(noMarmot);

    expect(result.migrated).toEqual({ [crafted]: [CHILD] });
    expect(await readOwned(CHILD, crafted)).toEqual([msg('child-only', 1)]);
    expect(await loadGroupMessages(PARENT, 'g_room')).toEqual([]);
  });
});

describe('storage reads wait for the migration', () => {
  it('shows migrated history to the owner on first load, and not to another account', async () => {
    const log = [msg('m1', 1)];
    await seedLegacy('g_room', log);
    await seedGroupList(PARENT, ['g_room']);

    expect(await loadGroupMessages(PARENT, 'g_room')).toEqual(log);
    expect(await loadGroupMessages(CHILD, 'g_room')).toEqual([]);
    expect(await AsyncStorage.getItem(legacyGroupMessagesKey('g_room'))).toBeNull();
  });
});
