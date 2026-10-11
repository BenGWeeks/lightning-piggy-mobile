// Storage-layer tests for `appendGroupMessage`, with focus on the
// local_*-vs-wrap-id reconciliation added in #402. Without it, the
// sender's own NIP-17 self-wrap echoed back from the relay never
// collided with the `local_<ts>_<rnd>` id we optimistically inserted
// on send — so a single user-intent send produced two rows in the
// thread (the duplicate-GIF symptom that prompted the fix).

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  appendGroupMessage,
  clearGroupMessages,
  loadGroupMessages,
  removeGroupMessage,
  removeGroupMessagesWhere,
  editGroupMessages,
  editGroupMessage,
  deleteGroupMessagesForOwner,
  listPersistedGroupWrapIds,
  reviveGroupHistoryOwner,
  type GroupMessage,
} from './groupMessagesStorageService';
import { resetGroupMessagesMigrationForTests } from './groupMessagesMigration';
import { groupMessagesKey, legacyGroupMessagesKey } from './groupMessagesKeys';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Controls the encrypted-DB Marmot owner lookup and the account registry.
const mockMarmotOwners = jest.fn(async (_mls: string): Promise<string[]> => []);
jest.mock('./marmotStore', () => ({
  listMarmotOwnersForGroup: (mls: string) => mockMarmotOwners(mls),
}));
let mockRegistered: string[] = [];
jest.mock('./identitiesStore', () => ({
  loadIdentities: async () => ({
    identities: mockRegistered.map((pubkey) => ({ pubkey })),
    activePubkey: null,
  }),
}));

const GROUP = 'g1';
const OWNER = '1'.repeat(64);
const OWNER_B = '2'.repeat(64);
const SENDER = 'a'.repeat(64);
const OTHER_SENDER = 'b'.repeat(64);

beforeEach(async () => {
  await AsyncStorage.clear();
  // A test that signs an owner out must not leave it retired for the next.
  reviveGroupHistoryOwner(OWNER);
  reviveGroupHistoryOwner(OWNER_B);
});

const local = (id: string, text: string, createdAt: number, sender = SENDER): GroupMessage => ({
  id,
  senderPubkey: sender,
  text,
  createdAt,
});

const wrap = (id: string, text: string, createdAt: number, sender = SENDER): GroupMessage => ({
  id,
  senderPubkey: sender,
  text,
  createdAt,
});

describe('appendGroupMessage — local_* vs wrap-id reconciliation (#402)', () => {
  it('absorbs the matching local_* row when the real wrap arrives', async () => {
    const t = 1700000000;
    await appendGroupMessage(OWNER, GROUP, local('local_1_aaa', 'hello', t));
    const after = await appendGroupMessage(OWNER, GROUP, wrap('w'.repeat(64), 'hello', t + 2));
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe('w'.repeat(64));
  });

  it('keeps both rows when the real wrap text differs from the optimistic row', async () => {
    const t = 1700000000;
    await appendGroupMessage(OWNER, GROUP, local('local_1_aaa', 'hello', t));
    const after = await appendGroupMessage(OWNER, GROUP, wrap('w'.repeat(64), 'goodbye', t + 1));
    expect(after).toHaveLength(2);
    expect(after.map((m) => m.id).sort()).toEqual(['local_1_aaa', 'w'.repeat(64)].sort());
  });

  it('keeps both rows when the real wrap sender differs', async () => {
    const t = 1700000000;
    await appendGroupMessage(OWNER, GROUP, local('local_1_aaa', 'hello', t));
    const after = await appendGroupMessage(
      OWNER,
      GROUP,
      wrap('w'.repeat(64), 'hello', t + 1, OTHER_SENDER),
    );
    expect(after).toHaveLength(2);
  });

  it('keeps both rows when the createdAt gap exceeds the 30s window', async () => {
    const t = 1700000000;
    await appendGroupMessage(OWNER, GROUP, local('local_1_aaa', 'hello', t));
    const after = await appendGroupMessage(OWNER, GROUP, wrap('w'.repeat(64), 'hello', t + 31));
    expect(after).toHaveLength(2);
  });

  it('only consumes ONE local_* row when two identical optimistic sends are pending', async () => {
    const t = 1700000000;
    await appendGroupMessage(OWNER, GROUP, local('local_1_aaa', 'lol', t));
    await appendGroupMessage(OWNER, GROUP, local('local_2_bbb', 'lol', t + 1));
    const after = await appendGroupMessage(OWNER, GROUP, wrap('w'.repeat(64), 'lol', t + 2));
    expect(after).toHaveLength(2);
    const ids = after.map((m) => m.id);
    expect(ids.filter((id) => id.startsWith('local_'))).toHaveLength(1);
    expect(ids).toContain('w'.repeat(64));
  });

  it('consumes the closest-createdAt local_* when two identical sends are pending and wraps arrive out-of-order', async () => {
    // Two optimistic sends at t and t+10. The relay echoes the t+10
    // wrap *first*; reconciliation should consume the t+10 local row,
    // not the t row that happens to come earlier in map iteration.
    const t = 1700000000;
    await appendGroupMessage(OWNER, GROUP, local('local_1_aaa', 'lol', t));
    await appendGroupMessage(OWNER, GROUP, local('local_2_bbb', 'lol', t + 10));
    const after = await appendGroupMessage(OWNER, GROUP, wrap('w'.repeat(64), 'lol', t + 11));
    const ids = after.map((m) => m.id);
    expect(ids).toContain('local_1_aaa');
    expect(ids).not.toContain('local_2_bbb');
    expect(ids).toContain('w'.repeat(64));
  });

  it('matches local_* even when the inbound wrap has lowercase senderPubkey and the optimistic row used mixed case', async () => {
    const t = 1700000000;
    const mixed = SENDER.toUpperCase();
    await appendGroupMessage(OWNER, GROUP, local('local_1_aaa', 'hello', t, mixed));
    const after = await appendGroupMessage(OWNER, GROUP, wrap('w'.repeat(64), 'hello', t + 1));
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe('w'.repeat(64));
  });
});

describe('appendGroupMessage — id-collision dedup (existing behaviour)', () => {
  it('keeps the newer copy when the same id is appended twice (createdAt wins)', async () => {
    const id = 'w'.repeat(64);
    await appendGroupMessage(OWNER, GROUP, wrap(id, 'first', 1700000000));
    const after = await appendGroupMessage(OWNER, GROUP, wrap(id, 'updated', 1700000005));
    expect(after).toHaveLength(1);
    expect(after[0].text).toBe('updated');
  });

  it('does not overwrite when the incoming copy is older than what we have', async () => {
    const id = 'w'.repeat(64);
    await appendGroupMessage(OWNER, GROUP, wrap(id, 'newer', 1700000005));
    const after = await appendGroupMessage(OWNER, GROUP, wrap(id, 'older', 1700000000));
    expect(after).toHaveLength(1);
    expect(after[0].text).toBe('newer');
  });
});

describe('appendGroupMessage — same-timestamp replay repair (#1241)', () => {
  const id = 'r'.repeat(64);
  const T = 1700000000;
  const VOICE = 'https://blossom.example/x#lpe=1&m=audio%2Fmp4';

  it('repairs a row stored blank (a pre-#1225 Marmot voice note)', async () => {
    await appendGroupMessage(OWNER, GROUP, wrap(id, '', T));
    const after = await appendGroupMessage(OWNER, GROUP, wrap(id, VOICE, T));
    expect(after).toHaveLength(1);
    expect(after[0].text).toBe(VOICE);
  });

  it('repairs a row stored as the attachment fallback label, in any locale', async () => {
    for (const label of [
      "Couldn't open attachment: voice.m4a",
      'Unsupported attachment: clip.mov (video/quicktime)',
    ]) {
      await AsyncStorage.clear();
      await appendGroupMessage(OWNER, GROUP, wrap(id, label, T));
      const after = await appendGroupMessage(OWNER, GROUP, wrap(id, VOICE, T));
      expect(after[0].text).toBe(VOICE);
    }
  });

  it('never replaces real text at the same timestamp, or with blank text', async () => {
    await appendGroupMessage(OWNER, GROUP, wrap(id, 'hello', T));
    expect((await appendGroupMessage(OWNER, GROUP, wrap(id, VOICE, T)))[0].text).toBe('hello');
    await AsyncStorage.clear();
    await appendGroupMessage(OWNER, GROUP, wrap(id, "Couldn't open attachment: a.jpg", T));
    expect((await appendGroupMessage(OWNER, GROUP, wrap(id, '', T)))[0].text).toBe(
      "Couldn't open attachment: a.jpg",
    );
  });
});

describe('appendGroupMessage — basic ordering & cap', () => {
  it('returns messages sorted by createdAt ascending', async () => {
    await appendGroupMessage(OWNER, GROUP, wrap('a'.repeat(64), 'first', 1700000010));
    await appendGroupMessage(OWNER, GROUP, wrap('b'.repeat(64), 'second', 1700000005));
    const after = await appendGroupMessage(OWNER, GROUP, wrap('c'.repeat(64), 'third', 1700000020));
    expect(after.map((m) => m.text)).toEqual(['second', 'first', 'third']);
  });

  it('clearGroupMessages removes the entry for the group', async () => {
    await appendGroupMessage(OWNER, GROUP, wrap('a'.repeat(64), 'hi', 1700000000));
    await clearGroupMessages(OWNER, GROUP);
    expect(await loadGroupMessages(OWNER, GROUP)).toEqual([]);
  });
});

describe('removeGroupMessage — failure-path retraction (#1033)', () => {
  it('removes the row with the given id and returns the remaining messages', async () => {
    const t = 1700000000;
    await appendGroupMessage(OWNER, GROUP, wrap('a'.repeat(64), 'first', t));
    await appendGroupMessage(OWNER, GROUP, local('local_1_aaa', 'second', t + 1));
    await appendGroupMessage(OWNER, GROUP, wrap('b'.repeat(64), 'third', t + 2));
    const after = await removeGroupMessage(OWNER, GROUP, 'local_1_aaa');
    expect(after).toHaveLength(2);
    expect(after.find((m) => m.id === 'local_1_aaa')).toBeUndefined();
  });

  it('is a no-op when the id is not found — returns the unmodified list and skips the write', async () => {
    const t = 1700000000;
    await appendGroupMessage(OWNER, GROUP, wrap('a'.repeat(64), 'only', t));
    const setItemSpy = AsyncStorage.setItem as jest.Mock;
    setItemSpy.mockClear();
    const after = await removeGroupMessage(OWNER, GROUP, 'nonexistent');
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe('a'.repeat(64));
    // A true no-op (nothing to remove) must not write back to AsyncStorage —
    // there's nothing to persist, and skipping the write avoids an
    // unnecessary rejection surface on an otherwise no-op call.
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it('returns an empty array when the group has no messages', async () => {
    const after = await removeGroupMessage(OWNER, GROUP, 'local_1_aaa');
    expect(after).toEqual([]);
  });

  it('rejects (does NOT return []) when the AsyncStorage write fails, and leaves the persisted thread untouched', async () => {
    await appendGroupMessage(OWNER, GROUP, wrap('a'.repeat(64), 'first', 1700000000));
    await appendGroupMessage(OWNER, GROUP, local('local_1_aaa', 'second', 1700000001));

    // NOTE: the async-storage-mock's setItem is already a jest.fn(), so
    // `jest.spyOn` returns that same mock rather than wrapping it — and a
    // later `.mockRestore()` on it wipes its real implementation for good
    // (there's no separate "original" to restore to), silently breaking
    // every subsequent test's persistence. `mockRejectedValueOnce` alone,
    // with no restore, is self-healing: it auto-reverts to the underlying
    // implementation once its one-shot queue is consumed.
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('transient storage error'));

    // The critical contract: a storage-write failure must surface as a
    // rejection, NOT as a resolved `[]` — a caller that did
    // `setMessages(await removeGroupMessage(...))` without this contract
    // would otherwise wipe the entire visible thread on a transient blip.
    await expect(removeGroupMessage(OWNER, GROUP, 'local_1_aaa')).rejects.toThrow(
      'transient storage error',
    );

    // Because the write never committed, the thread persisted in storage
    // must be completely unchanged — both rows still present.
    const persisted = await loadGroupMessages(OWNER, GROUP);
    expect(persisted).toHaveLength(2);
    expect(persisted.map((m) => m.id).sort()).toEqual(['a'.repeat(64), 'local_1_aaa'].sort());
  });
});

describe('per-account scoping (#1240)', () => {
  it("stores each account's log under its own key", async () => {
    await appendGroupMessage(OWNER, GROUP, wrap('a'.repeat(64), 'hi', 1700000000));
    expect(await AsyncStorage.getAllKeys()).toEqual([groupMessagesKey(OWNER, GROUP)]);
  });

  it("never reads another account's history for the same group id", async () => {
    await appendGroupMessage(OWNER, GROUP, wrap('a'.repeat(64), 'parent only', 1700000000));
    expect(await loadGroupMessages(OWNER_B, GROUP)).toEqual([]);
    expect(await listPersistedGroupWrapIds(OWNER_B)).toEqual([]);
    expect(await listPersistedGroupWrapIds(OWNER)).toEqual(['a'.repeat(64)]);
  });

  it('treats the owner case-insensitively', async () => {
    await appendGroupMessage(OWNER.toUpperCase(), GROUP, wrap('a'.repeat(64), 'hi', 1700000000));
    expect(await loadGroupMessages(OWNER, GROUP)).toHaveLength(1);
  });

  it('never falls back to a legacy device-wide blob', async () => {
    await AsyncStorage.setItem(
      legacyGroupMessagesKey(GROUP),
      JSON.stringify([wrap('a'.repeat(64), 'legacy', 1700000000)]),
    );
    expect(await loadGroupMessages(OWNER, GROUP)).toEqual([]);
  });

  it('reads empty and refuses to write without a valid owner', async () => {
    expect(await loadGroupMessages(null, GROUP)).toEqual([]);
    expect(await listPersistedGroupWrapIds('')).toEqual([]);
    await expect(
      appendGroupMessage(null, GROUP, wrap('a'.repeat(64), 'hi', 1700000000)),
    ).rejects.toThrow();
    await expect(removeGroupMessage('not-a-pubkey', GROUP, 'x')).rejects.toThrow();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });
});

describe('deleteGroupMessagesForOwner — sign-out isolation (#1240)', () => {
  it("removes only the signed-out account's logs", async () => {
    await appendGroupMessage(OWNER, GROUP, wrap('a'.repeat(64), 'child', 1700000000));
    await appendGroupMessage(OWNER, 'marmot:ab', wrap('b'.repeat(64), 'child', 1700000001));
    await appendGroupMessage(OWNER_B, GROUP, wrap('c'.repeat(64), 'parent', 1700000002));
    await appendGroupMessage(OWNER_B, 'marmot:ab', wrap('d'.repeat(64), 'parent', 1700000003));

    await deleteGroupMessagesForOwner(OWNER);

    expect(await loadGroupMessages(OWNER, GROUP)).toEqual([]);
    expect(await loadGroupMessages(OWNER, 'marmot:ab')).toEqual([]);
    expect((await loadGroupMessages(OWNER_B, GROUP)).map((m) => m.text)).toEqual(['parent']);
    expect((await loadGroupMessages(OWNER_B, 'marmot:ab')).map((m) => m.text)).toEqual(['parent']);
  });

  it('is a no-op for an invalid owner', async () => {
    await appendGroupMessage(OWNER_B, GROUP, wrap('c'.repeat(64), 'parent', 1700000002));
    await deleteGroupMessagesForOwner(null);
    expect(await loadGroupMessages(OWNER_B, GROUP)).toHaveLength(1);
  });
});

describe('removeGroupMessagesWhere', () => {
  it('erases flagged messages from storage and leaves the rest', async () => {
    await appendGroupMessage(OWNER, GROUP, wrap('a'.repeat(64), 'secret', 1));
    await appendGroupMessage(OWNER, GROUP, wrap('b'.repeat(64), 'keep', 2, OTHER_SENDER));
    const left = await removeGroupMessagesWhere(OWNER, GROUP, (m) => m.text === 'secret');
    expect(left.map((m) => m.text)).toEqual(['keep']);
    expect((await loadGroupMessages(OWNER, GROUP)).map((m) => m.text)).toEqual(['keep']);
    expect(JSON.stringify(await AsyncStorage.getAllKeys())).toContain(GROUP);
    expect(await AsyncStorage.getItem(groupMessagesKey(OWNER, GROUP))).not.toContain('secret');
  });
});

it.each([false, true])('serializes append and deletion (append first: %s)', async (appendFirst) => {
  await appendGroupMessage(OWNER, GROUP, wrap('target', 'deleted plaintext', 1));
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = AsyncStorage.setItem;
  (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(async (key, value) => {
    entered();
    await pause;
    // The one-shot implementation has been consumed; use the underlying mock.
    return original(key, value);
  });
  const append = () => appendGroupMessage(OWNER, GROUP, local('local_new', 'new send', 2));
  const remove = () => removeGroupMessagesWhere(OWNER, GROUP, (m) => m.id === 'target');
  const first = appendFirst ? append() : remove();
  await started;
  const second = appendFirst ? remove() : append();
  release();
  await Promise.all([first, second]);
  expect((await loadGroupMessages(OWNER, GROUP)).map((m) => m.text)).toEqual(['new send']);
});

describe('editGroupMessage', () => {
  const ID = 'a'.repeat(64);
  beforeEach(async () => {
    await appendGroupMessage(OWNER, GROUP, wrap(ID, 'v1', 1));
  });
  it('replaces the text for the author and marks it edited', async () => {
    expect(await editGroupMessage(OWNER, GROUP, ID, SENDER, 'v2', 50)).toBe(true);
    expect((await loadGroupMessages(OWNER, GROUP))[0]).toMatchObject({ text: 'v2', editedAt: 50 });
  });
  it('ignores an edit from anyone else', async () => {
    expect(await editGroupMessage(OWNER, GROUP, ID, OTHER_SENDER, 'hijack', 50)).toBe(false);
    expect((await loadGroupMessages(OWNER, GROUP))[0].text).toBe('v1');
  });
  it('is latest-wins by the edit time', async () => {
    await editGroupMessage(OWNER, GROUP, ID, SENDER, 'v3', 90);
    expect(await editGroupMessage(OWNER, GROUP, ID, SENDER, 'v2', 50)).toBe(false);
    expect((await loadGroupMessages(OWNER, GROUP))[0].text).toBe('v3');
  });
  it('leaves a replayed original alone once edited', async () => {
    await editGroupMessage(OWNER, GROUP, ID, SENDER, 'v2', 50);
    await appendGroupMessage(OWNER, GROUP, wrap(ID, 'v1', 1));
    expect((await loadGroupMessages(OWNER, GROUP))[0].text).toBe('v2');
  });
  it('does not rewrite a photo or voice note', async () => {
    await appendGroupMessage(OWNER, GROUP, wrap('b'.repeat(64), 'https://x/y#lpe=1&k=a&n=b', 2));
    expect(await editGroupMessage(OWNER, GROUP, 'b'.repeat(64), SENDER, 'text', 50)).toBe(false);
  });
});

it('serializes edits with deletion so a stale edit cannot restore deleted plaintext', async () => {
  await appendGroupMessage(OWNER, GROUP, wrap('deleted', 'secret', 1));
  await appendGroupMessage(OWNER, GROUP, wrap('edited', 'v1', 2));
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = AsyncStorage.setItem;
  (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(async (key, value) => {
    entered();
    await pause;
    return original(key, value);
  });
  const edit = editGroupMessage(OWNER, GROUP, 'edited', SENDER, 'v2', 3);
  await started;
  const removal = removeGroupMessagesWhere(OWNER, GROUP, (m) => m.id === 'deleted');
  release();
  await Promise.all([edit, removal]);
  expect((await loadGroupMessages(OWNER, GROUP)).map((m) => m.text)).toEqual(['v2']);
});

describe('editGroupMessages', () => {
  const edit = (target: string, content: string, editedAt: number, editId: string) => ({
    target,
    content,
    editor: SENDER,
    editedAt,
    editId,
  });

  it('applies a whole batch with one load and one write', async () => {
    await appendGroupMessage(OWNER, GROUP, wrap('m1', 'a', 1));
    await appendGroupMessage(OWNER, GROUP, wrap('m2', 'b', 2));
    const getItem = jest.spyOn(AsyncStorage, 'getItem');
    const setItem = jest.spyOn(AsyncStorage, 'setItem');
    getItem.mockClear();
    setItem.mockClear();
    expect(
      await editGroupMessages(OWNER, GROUP, [edit('m1', 'A', 5, 'x'), edit('m2', 'B', 5, 'y')]),
    ).toBe(true);
    expect(getItem).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect((await loadGroupMessages(OWNER, GROUP)).map((m) => m.text)).toEqual(['A', 'B']);
  });

  it('writes nothing when no edit applies (a replayed history)', async () => {
    await appendGroupMessage(OWNER, GROUP, wrap('m1', 'a', 1));
    await editGroupMessages(OWNER, GROUP, [edit('m1', 'A', 5, 'x')]);
    const setItem = jest.spyOn(AsyncStorage, 'setItem');
    setItem.mockClear();
    expect(await editGroupMessages(OWNER, GROUP, [edit('m1', 'A', 5, 'x')])).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('settles same-second edits on the higher edit id', async () => {
    await appendGroupMessage(OWNER, GROUP, wrap('m1', 'a', 1));
    await editGroupMessages(OWNER, GROUP, [edit('m1', 'v3', 5, '2')]);
    await editGroupMessages(OWNER, GROUP, [edit('m1', 'v2', 5, '1')]);
    expect((await loadGroupMessages(OWNER, GROUP))[0]).toMatchObject({ text: 'v3', editId: '2' });
  });

  it('never rewrites a poll, vote or order (stored as JSON) or a legacy text poll', async () => {
    await appendGroupMessage(OWNER, GROUP, wrap('poll', '{"question":"Pizza?","options":[]}', 1));
    await appendGroupMessage(
      OWNER,
      GROUP,
      wrap('legacy', '[POLL]\nquestion: Pizza?\noption:1: Yes\noption:2: No', 2),
    );
    expect(
      await editGroupMessages(OWNER, GROUP, [
        edit('poll', 'swap', 5, 'x'),
        edit('legacy', 'swap', 5, 'y'),
      ]),
    ).toBe(false);
  });
});

describe('sign-out write guard (#1240 review)', () => {
  afterEach(() => {
    reviveGroupHistoryOwner(OWNER);
    reviveGroupHistoryOwner(OWNER_B);
  });

  it('refuses a late append after the account was signed out, until it is active again', async () => {
    await appendGroupMessage(OWNER, GROUP, wrap('a'.repeat(64), 'before', 1700000000));
    await deleteGroupMessagesForOwner(OWNER);

    // e.g. useMarmotGroups' unmount flush, or a rumor still being routed.
    await expect(
      appendGroupMessage(OWNER, GROUP, wrap('b'.repeat(64), 'late', 1700000001)),
    ).rejects.toThrow('signed-out');
    await expect(removeGroupMessage(OWNER, GROUP, 'x')).rejects.toThrow('signed-out');
    expect((await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('group_history_'))).toEqual(
      [],
    );

    reviveGroupHistoryOwner(OWNER); // signed back in
    await appendGroupMessage(OWNER, GROUP, wrap('c'.repeat(64), 'again', 1700000002));
    expect(await loadGroupMessages(OWNER, GROUP)).toHaveLength(1);
  });

  it("doesn't affect another account", async () => {
    await deleteGroupMessagesForOwner(OWNER);
    await appendGroupMessage(OWNER_B, GROUP, wrap('d'.repeat(64), 'parent', 1700000003));
    expect(await loadGroupMessages(OWNER_B, GROUP)).toHaveLength(1);
  });
});

describe('sign-out leaves no legacy plaintext behind (#689, #1240 review)', () => {
  beforeEach(() => {
    resetGroupMessagesMigrationForTests();
    mockRegistered = [];
  });
  afterEach(() => reviveGroupHistoryOwner(OWNER));

  it('migration deferred at launch (Marmot DB unreadable) → last sign-out → nothing left', async () => {
    mockMarmotOwners.mockRejectedValue(new Error('db locked'));
    await AsyncStorage.setItem(
      'group_messages_marmot:ab12',
      JSON.stringify([wrap('a'.repeat(64), 'x', 1)]),
    );
    await AsyncStorage.setItem('group_messages_g_left_before_upgrade', JSON.stringify([]));
    expect(await loadGroupMessages(OWNER, 'marmot:ab12')).toEqual([]); // launch: deferred, unshown
    mockRegistered = [OWNER];

    await deleteGroupMessagesForOwner(OWNER);

    const left = (await AsyncStorage.getAllKeys()).filter((k) =>
      /^group_(messages|history)_/.test(k),
    );
    expect(left).toEqual([]);
    mockMarmotOwners.mockReset();
    mockMarmotOwners.mockResolvedValue([]);
  });

  it('a legacy blob the remaining account owns is copied to it, not deleted', async () => {
    mockMarmotOwners.mockRejectedValueOnce(new Error('db locked')); // launch run
    await AsyncStorage.setItem(
      'group_messages_marmot:cd34',
      JSON.stringify([wrap('a'.repeat(64), 'x', 1)]),
    );
    expect(await loadGroupMessages(OWNER_B, 'marmot:cd34')).toEqual([]);
    mockRegistered = [OWNER, OWNER_B];
    mockMarmotOwners.mockResolvedValueOnce([OWNER_B]); // sign-out run: DB readable again

    await deleteGroupMessagesForOwner(OWNER);

    expect((await loadGroupMessages(OWNER_B, 'marmot:cd34')).map((m) => m.text)).toEqual(['x']);
    expect(await AsyncStorage.getItem('group_messages_marmot:cd34')).toBeNull();
  });
});
