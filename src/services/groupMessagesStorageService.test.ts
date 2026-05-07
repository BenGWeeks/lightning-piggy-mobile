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
  removeGroupMessages,
  loadGroupMessages,
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
describe('removeGroupMessages', () => {
  it('drops only the requested ids and preserves order', async () => {
    await appendGroupMessage(GROUP_ID, msg('m1', 100));
    await appendGroupMessage(GROUP_ID, msg('m2', 200));
    await appendGroupMessage(GROUP_ID, msg('m3', 300));

    const after = await removeGroupMessages(GROUP_ID, ['m2']);

    expect(after.map((m) => m.id)).toEqual(['m1', 'm3']);
    // Re-load round-trip to prove the change is persisted, not just
    // returned from the in-memory call.
    const reloaded = await loadGroupMessages(GROUP_ID);
    expect(reloaded.map((m) => m.id)).toEqual(['m1', 'm3']);
  });

  it('handles a multi-id delete in one write', async () => {
    await appendGroupMessage(GROUP_ID, msg('m1', 100));
    await appendGroupMessage(GROUP_ID, msg('m2', 200));
    await appendGroupMessage(GROUP_ID, msg('m3', 300));
    await appendGroupMessage(GROUP_ID, msg('m4', 400));

    const after = await removeGroupMessages(GROUP_ID, ['m1', 'm3']);

    expect(after.map((m) => m.id)).toEqual(['m2', 'm4']);
  });

  it('is a no-op when ids is empty (skips the storage write)', async () => {
    await appendGroupMessage(GROUP_ID, msg('m1', 100));
    // Use the underlying mock fn directly — spyOn would wrap the existing
    // jest.fn() implementation and mockClear() on the spy doesn't reach
    // through to the real mock's call ledger.
    const setItemMock = AsyncStorage.setItem as jest.Mock;
    setItemMock.mockClear();

    const after = await removeGroupMessages(GROUP_ID, []);

    expect(after.map((m) => m.id)).toEqual(['m1']);
    expect(setItemMock).not.toHaveBeenCalled();
  });

  it('is a no-op when no ids match (skips the storage write)', async () => {
    await appendGroupMessage(GROUP_ID, msg('m1', 100));
    const setItemMock = AsyncStorage.setItem as jest.Mock;
    setItemMock.mockClear();

    const after = await removeGroupMessages(GROUP_ID, ['ghost-id']);

    expect(after.map((m) => m.id)).toEqual(['m1']);
    expect(setItemMock).not.toHaveBeenCalled();
  });

  it('returns an empty list when the cache was already empty', async () => {
    const after = await removeGroupMessages(GROUP_ID, ['anything']);
    expect(after).toEqual([]);
  });

  it('does not affect other groups stored in the same AsyncStorage', async () => {
    await appendGroupMessage('g_other', msg('m1', 100));
    await appendGroupMessage(GROUP_ID, msg('m1', 200));

    await removeGroupMessages(GROUP_ID, ['m1']);

    const target = await loadGroupMessages(GROUP_ID);
    const other = await loadGroupMessages('g_other');
    expect(target).toEqual([]);
    expect(other.map((m) => m.id)).toEqual(['m1']);
  });
});
