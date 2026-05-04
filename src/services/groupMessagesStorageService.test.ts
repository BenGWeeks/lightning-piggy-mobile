/**
 * Storage-layer tests for the group-message cache. The two functions
 * under test back the swipe-to-delete affordance (#128) and the
 * existing optimistic-append path; both write through to AsyncStorage,
 * so we exercise a fresh in-memory mock per test and assert the
 * post-state via re-load.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  appendGroupMessage,
  loadGroupMessages,
  removeGroupMessages,
  type GroupMessage,
} from './groupMessagesStorageService';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const GROUP_ID = 'g_test_room';

function msg(id: string, createdAt: number, text = `body-${id}`): GroupMessage {
  return { id, senderPubkey: 'a'.repeat(64), text, createdAt };
}

beforeEach(async () => {
  await AsyncStorage.clear();
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
