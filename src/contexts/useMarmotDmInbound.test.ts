import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMarmotDmInbound } from './useMarmotDmInbound';
import { deleteMarmotMessages, getConversationMessages, type DmMessageRow } from '../services/dmDb';
import { rowsToInboxEntries } from '../services/dmInbox';
import type { MarmotMessageEvent } from '../services/marmotSession';
import type { DmInboxEntry } from '../utils/conversationSummaries';
import { notifyDmMessage } from './nostrEventBus';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
let mockOnMessage: (event: MarmotMessageEvent) => void;
jest.mock('../services/marmotSession', () => ({
  MARMOT_CHAT_KIND: 9,
  subscribeMarmotSession: (cb: (session: unknown) => void) => {
    cb({
      pubkey: 'alice',
      subscribe: (handlers: { onMessage: typeof mockOnMessage }) => {
        mockOnMessage = handlers.onMessage;
        return () => {};
      },
    });
    return () => {};
  },
}));
jest.mock('../services/dmDb', () => ({
  deleteMarmotMessages: jest.fn().mockResolvedValue([]),
  deleteMarmotRowsOfKinds: jest.fn().mockResolvedValue(undefined),
  getConversationMessages: jest.fn(),
  upsertDmMessages: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/notificationService', () => ({
  dismissNotificationsFor: jest.fn(),
  fireMessageNotification: jest.fn(),
}));
jest.mock('./nostrEventBus', () => ({ notifyDmMessage: jest.fn() }));
const id = 'a'.repeat(64);
const latest: DmMessageRow = {
  owner: 'alice',
  eventId: id,
  conversation: 'bob',
  sender: 'alice',
  content: 'latest',
  fromMe: true,
  wireKind: 14,
  createdAt: 2,
  protocol: 'marmot',
};
const deletion = {
  group: {
    id: 'g',
    name: 'Group',
    description: '',
    relays: [],
    createdAt: 1,
    isDm: true,
    memberPubkeys: ['bob'],
    adminPubkeys: [],
  },
  rumor: { id: 'delete', kind: 5, pubkey: 'bob', tags: [['e', id]], content: '', created_at: 3 },
} as MarmotMessageEvent;
beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
});
afterEach(() => jest.useRealTimers());

it('keeps the actual latest preview after an unauthorized delete with an older inbox entry', async () => {
  (getConversationMessages as jest.Mock).mockResolvedValue([latest]);
  const unrelated = { ...rowsToInboxEntries([latest])[0], partnerPubkey: 'carol' };
  let inbox = [
    ...rowsToInboxEntries([latest, { ...latest, eventId: 'old', createdAt: 1, content: 'old' }]),
    unrelated,
  ];
  const setter = (update: React.SetStateAction<DmInboxEntry[]>) => {
    inbox = typeof update === 'function' ? update(inbox) : update;
  };
  renderHook(() => useMarmotDmInbound('alice', setter));
  await act(async () => {
    mockOnMessage(deletion);
    await jest.advanceTimersByTimeAsync(150);
  });
  expect(deleteMarmotMessages).toHaveBeenCalledWith('alice', 'bob', [id], 'bob');
  expect(inbox.filter((e) => e.partnerPubkey === 'bob').map((e) => e.text)).toEqual(['latest']);
  expect(inbox).toContain(unrelated);
});

it('uses actual deleted IDs and reconciles the newest remaining row', async () => {
  (deleteMarmotMessages as jest.Mock).mockResolvedValueOnce([id]);
  (getConversationMessages as jest.Mock).mockResolvedValue([
    { ...latest, eventId: 'old', content: 'fallback', createdAt: 1 },
  ]);
  let inbox = rowsToInboxEntries([latest]);
  renderHook(() =>
    useMarmotDmInbound('alice', (update) => {
      inbox = typeof update === 'function' ? update(inbox) : update;
    }),
  );
  await act(async () => {
    mockOnMessage(deletion);
    await jest.advanceTimersByTimeAsync(150);
  });
  expect(inbox.map((e) => e.text)).toEqual(['fallback']);
});

it('does not publish old-account previews after cleanup while deletion is awaiting storage', async () => {
  let release!: (rows: DmMessageRow[]) => void;
  (getConversationMessages as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const setter = jest.fn();
  const { unmount } = renderHook(() => useMarmotDmInbound('alice', setter));
  await act(async () => {
    mockOnMessage(deletion);
    await jest.advanceTimersByTimeAsync(150);
  });
  unmount();
  await act(async () => {
    release([latest]);
    await Promise.resolve();
  });
  expect(setter).not.toHaveBeenCalled();
  expect(notifyDmMessage).not.toHaveBeenCalled();
});
