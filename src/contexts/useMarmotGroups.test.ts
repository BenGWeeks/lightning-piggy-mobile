import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMarmotGroups } from './useMarmotGroups';
import { appendGroupMessage, loadGroupMessages } from '../services/groupMessagesStorageService';
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
  dismissNotificationsFor: jest.fn(),
  fireMessageNotification: jest.fn(),
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
