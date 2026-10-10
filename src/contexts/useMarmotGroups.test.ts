import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMarmotGroups } from './useMarmotGroups';
import { appendGroupMessage, loadGroupMessages } from '../services/groupMessagesStorageService';
import { getLocalDb } from '../services/localDb';
import type { MarmotMessageEvent } from '../services/marmotSession';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
let mockOnMessage: (event: MarmotMessageEvent) => void;
jest.mock('../services/marmotSession', () => ({
  MARMOT_CHAT_KIND: 9,
  subscribeMarmotSession: (cb: (session: unknown) => void) => {
    cb({
      pubkey: 'alice',
      listGroups: () => [],
      subscribe: (handlers: { onMessage: typeof mockOnMessage }) => {
        mockOnMessage = handlers.onMessage;
        return () => {};
      },
    });
    return () => {};
  },
}));
jest.mock('../services/marmotSend', () => ({ requireMarmotSession: jest.fn() }));
jest.mock('../services/notificationService', () => ({
  retractMarmotMessageNotifications: jest.fn().mockResolvedValue(0),
  fireMessageNotification: jest.fn(),
}));
// Real tombstone store (SQL) on Node's SQLite.
jest.mock('@op-engineering/op-sqlite', () =>
  require('../services/testUtils/nodeSqliteOpSqlite').nodeSqliteOpSqlite(),
);
jest.mock('../services/localDbKey', () => ({
  getOrCreateLocalDbKey: jest.fn(() => Promise.resolve('k')),
  clearLocalDbKey: jest.fn(() => Promise.resolve()),
}));
const id = 'a'.repeat(64);
const group = {
  id: 'g',
  name: 'Group',
  description: '',
  relays: [],
  createdAt: 1,
  isDm: false,
  memberPubkeys: ['alice', 'bob'],
  adminPubkeys: [],
};
const remove = (target: string, sender = 'alice') =>
  ({
    group,
    rumor: {
      id: 'delete',
      kind: 5,
      pubkey: sender,
      tags: [['e', target]],
      content: '',
      created_at: 1,
    },
  }) as MarmotMessageEvent;

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  await (await getLocalDb()).execute('DELETE FROM marmot_deletions;');
});
afterEach(() => jest.useRealTimers());
it('applies a deletion after 2001 unrelated targets evict it before flush, then blocks replay after remount', async () => {
  await appendGroupMessage('g', {
    id,
    senderPubkey: 'alice',
    text: 'deleted plaintext',
    createdAt: 1,
  });
  const { unmount } = renderHook(() => useMarmotGroups('alice'));
  await act(async () => {
    mockOnMessage(remove(id));
    mockOnMessage(remove(id, 'bob'));
    for (let i = 0; i < 2001; i++) mockOnMessage(remove(i.toString(16).padStart(64, '0'), 'bob'));
    await jest.advanceTimersByTimeAsync(150);
  });
  expect(await loadGroupMessages('g')).toEqual([]);
  unmount();
  renderHook(() => useMarmotGroups('alice'));
  await act(async () => {
    mockOnMessage({
      group,
      rumor: {
        id,
        pubkey: 'alice',
        kind: 9,
        content: 'deleted plaintext',
        tags: [],
        created_at: 1,
      },
    } as MarmotMessageEvent);
    await jest.advanceTimersByTimeAsync(150);
  });
  expect(await loadGroupMessages('g')).toEqual([]);
});

const message = (msgId: string, sender: string, text: string) =>
  ({
    group,
    rumor: { id: msgId, pubkey: sender, kind: 9, content: text, tags: [], created_at: 1 },
  }) as MarmotMessageEvent;

it('drops a message whose delete lands in the same batch, and keeps the rest', async () => {
  renderHook(() => useMarmotGroups('alice'));
  await act(async () => {
    mockOnMessage(message(id, 'bob', 'deleted'));
    mockOnMessage(message('b'.repeat(64), 'bob', 'kept'));
    mockOnMessage(remove(id, 'bob'));
    await jest.advanceTimersByTimeAsync(150);
  });
  expect((await loadGroupMessages('g')).map((m) => m.text)).toEqual(['kept']);
});

it("ignores a member's delete of someone else's message, and a non-admin's kind 4891", async () => {
  await appendGroupMessage('g', { id, senderPubkey: 'alice', text: 'mine', createdAt: 1 });
  renderHook(() => useMarmotGroups('alice'));
  const adminRemove = {
    group,
    rumor: {
      id: 'admin-remove',
      kind: 4891,
      pubkey: 'bob',
      tags: [['e', id]],
      content: '{"v":1,"action":"remove"}',
      created_at: 1,
    },
  } as MarmotMessageEvent;
  await act(async () => {
    mockOnMessage(remove(id, 'bob'));
    mockOnMessage(adminRemove);
    await jest.advanceTimersByTimeAsync(150);
  });
  expect((await loadGroupMessages('g')).map((m) => m.text)).toEqual(['mine']);
  // With admin rights, the same 4891 removes it.
  const promoted = { ...group, adminPubkeys: ['bob'] };
  await act(async () => {
    mockOnMessage({ ...adminRemove, group: promoted });
    await jest.advanceTimersByTimeAsync(150);
  });
  expect(await loadGroupMessages('g')).toEqual([]);
});
