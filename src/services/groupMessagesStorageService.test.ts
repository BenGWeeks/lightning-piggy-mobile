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
  GROUP_MESSAGES_KEY_PREFIX,
  type GroupMessage,
} from './groupMessagesStorageService';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const GROUP = 'g1';
const SENDER = 'a'.repeat(64);
const OTHER_SENDER = 'b'.repeat(64);

beforeEach(async () => {
  await AsyncStorage.clear();
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
    await appendGroupMessage(GROUP, local('local_1_aaa', 'hello', t));
    const after = await appendGroupMessage(GROUP, wrap('w'.repeat(64), 'hello', t + 2));
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe('w'.repeat(64));
  });

  it('keeps both rows when the real wrap text differs from the optimistic row', async () => {
    const t = 1700000000;
    await appendGroupMessage(GROUP, local('local_1_aaa', 'hello', t));
    const after = await appendGroupMessage(GROUP, wrap('w'.repeat(64), 'goodbye', t + 1));
    expect(after).toHaveLength(2);
    expect(after.map((m) => m.id).sort()).toEqual(['local_1_aaa', 'w'.repeat(64)].sort());
  });

  it('keeps both rows when the real wrap sender differs', async () => {
    const t = 1700000000;
    await appendGroupMessage(GROUP, local('local_1_aaa', 'hello', t));
    const after = await appendGroupMessage(
      GROUP,
      wrap('w'.repeat(64), 'hello', t + 1, OTHER_SENDER),
    );
    expect(after).toHaveLength(2);
  });

  it('keeps both rows when the createdAt gap exceeds the 30s window', async () => {
    const t = 1700000000;
    await appendGroupMessage(GROUP, local('local_1_aaa', 'hello', t));
    const after = await appendGroupMessage(GROUP, wrap('w'.repeat(64), 'hello', t + 31));
    expect(after).toHaveLength(2);
  });

  it('only consumes ONE local_* row when two identical optimistic sends are pending', async () => {
    const t = 1700000000;
    await appendGroupMessage(GROUP, local('local_1_aaa', 'lol', t));
    await appendGroupMessage(GROUP, local('local_2_bbb', 'lol', t + 1));
    const after = await appendGroupMessage(GROUP, wrap('w'.repeat(64), 'lol', t + 2));
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
    await appendGroupMessage(GROUP, local('local_1_aaa', 'lol', t));
    await appendGroupMessage(GROUP, local('local_2_bbb', 'lol', t + 10));
    const after = await appendGroupMessage(GROUP, wrap('w'.repeat(64), 'lol', t + 11));
    const ids = after.map((m) => m.id);
    expect(ids).toContain('local_1_aaa');
    expect(ids).not.toContain('local_2_bbb');
    expect(ids).toContain('w'.repeat(64));
  });

  it('matches local_* even when the inbound wrap has lowercase senderPubkey and the optimistic row used mixed case', async () => {
    const t = 1700000000;
    const mixed = SENDER.toUpperCase();
    await appendGroupMessage(GROUP, local('local_1_aaa', 'hello', t, mixed));
    const after = await appendGroupMessage(GROUP, wrap('w'.repeat(64), 'hello', t + 1));
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe('w'.repeat(64));
  });
});

describe('appendGroupMessage — id-collision dedup (existing behaviour)', () => {
  it('keeps the newer copy when the same id is appended twice (createdAt wins)', async () => {
    const id = 'w'.repeat(64);
    await appendGroupMessage(GROUP, wrap(id, 'first', 1700000000));
    const after = await appendGroupMessage(GROUP, wrap(id, 'updated', 1700000005));
    expect(after).toHaveLength(1);
    expect(after[0].text).toBe('updated');
  });

  it('does not overwrite when the incoming copy is older than what we have', async () => {
    const id = 'w'.repeat(64);
    await appendGroupMessage(GROUP, wrap(id, 'newer', 1700000005));
    const after = await appendGroupMessage(GROUP, wrap(id, 'older', 1700000000));
    expect(after).toHaveLength(1);
    expect(after[0].text).toBe('newer');
  });
});

describe('appendGroupMessage — basic ordering & cap', () => {
  it('returns messages sorted by createdAt ascending', async () => {
    await appendGroupMessage(GROUP, wrap('a'.repeat(64), 'first', 1700000010));
    await appendGroupMessage(GROUP, wrap('b'.repeat(64), 'second', 1700000005));
    const after = await appendGroupMessage(GROUP, wrap('c'.repeat(64), 'third', 1700000020));
    expect(after.map((m) => m.text)).toEqual(['second', 'first', 'third']);
  });

  it('clearGroupMessages removes the entry for the group', async () => {
    await appendGroupMessage(GROUP, wrap('a'.repeat(64), 'hi', 1700000000));
    await clearGroupMessages(GROUP);
    expect(await loadGroupMessages(GROUP)).toEqual([]);
  });
});

describe('removeGroupMessage — failure-path retraction (#1033)', () => {
  it('removes the row with the given id and returns the remaining messages', async () => {
    const t = 1700000000;
    await appendGroupMessage(GROUP, wrap('a'.repeat(64), 'first', t));
    await appendGroupMessage(GROUP, local('local_1_aaa', 'second', t + 1));
    await appendGroupMessage(GROUP, wrap('b'.repeat(64), 'third', t + 2));
    const after = await removeGroupMessage(GROUP, 'local_1_aaa');
    expect(after).toHaveLength(2);
    expect(after.find((m) => m.id === 'local_1_aaa')).toBeUndefined();
  });

  it('is a no-op when the id is not found — returns the unmodified list and skips the write', async () => {
    const t = 1700000000;
    await appendGroupMessage(GROUP, wrap('a'.repeat(64), 'only', t));
    const setItemSpy = AsyncStorage.setItem as jest.Mock;
    setItemSpy.mockClear();
    const after = await removeGroupMessage(GROUP, 'nonexistent');
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe('a'.repeat(64));
    // A true no-op (nothing to remove) must not write back to AsyncStorage —
    // there's nothing to persist, and skipping the write avoids an
    // unnecessary rejection surface on an otherwise no-op call.
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it('returns an empty array when the group has no messages', async () => {
    const after = await removeGroupMessage(GROUP, 'local_1_aaa');
    expect(after).toEqual([]);
  });

  it('rejects (does NOT return []) when the AsyncStorage write fails, and leaves the persisted thread untouched', async () => {
    await appendGroupMessage(GROUP, wrap('a'.repeat(64), 'first', 1700000000));
    await appendGroupMessage(GROUP, local('local_1_aaa', 'second', 1700000001));

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
    await expect(removeGroupMessage(GROUP, 'local_1_aaa')).rejects.toThrow(
      'transient storage error',
    );

    // Because the write never committed, the thread persisted in storage
    // must be completely unchanged — both rows still present.
    const persisted = await loadGroupMessages(GROUP);
    expect(persisted).toHaveLength(2);
    expect(persisted.map((m) => m.id).sort()).toEqual(['a'.repeat(64), 'local_1_aaa'].sort());
  });
});

describe('GROUP_MESSAGES_KEY_PREFIX — logout-wipe contract', () => {
  // The logout / account-wipe path (NostrContext.wipeAccountCaches) removes
  // every AsyncStorage key starting with this prefix so decrypted group
  // plaintext can't survive logout. Pin the stored key shape to the prefix
  // so a rename can't silently break that wipe.
  it('every persisted group blob is keyed under the wipe prefix', async () => {
    await appendGroupMessage(GROUP, wrap('a'.repeat(64), 'hi', 1700000000));
    const keys = await AsyncStorage.getAllKeys();
    const groupKeys = keys.filter((k) => k.startsWith(GROUP_MESSAGES_KEY_PREFIX));
    expect(groupKeys).toContain(`${GROUP_MESSAGES_KEY_PREFIX}${GROUP}`);
    expect(groupKeys).toHaveLength(1);
  });
});
