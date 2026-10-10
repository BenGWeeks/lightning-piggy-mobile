import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMarmotDmInbound } from './useMarmotDmInbound';
import {
  deleteMarmotMessages,
  getConversationMessages,
  upsertDmMessages,
  type DmMessageRow,
} from '../services/dmDb';
import { getLocalDb } from '../services/localDb';
import { retractMarmotMessageNotifications } from '../services/notificationService';
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
  retractMarmotMessageNotifications: jest.fn().mockResolvedValue(0),
  fireMessageNotification: jest.fn(),
}));
// Real tombstone store (SQL) on Node's SQLite; dm_messages itself is mocked above.
jest.mock('@op-engineering/op-sqlite', () =>
  require('../services/testUtils/nodeSqliteOpSqlite').nodeSqliteOpSqlite(),
);
jest.mock('../services/localDbKey', () => ({
  getOrCreateLocalDbKey: jest.fn(() => Promise.resolve('k')),
  clearLocalDbKey: jest.fn(() => Promise.resolve()),
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
  await (await getLocalDb()).execute('DELETE FROM marmot_deletions;');
});
afterEach(() => jest.useRealTimers());

it('leaves the inbox alone when a delete removed nothing (unauthorized, or a replay)', async () => {
  (getConversationMessages as jest.Mock).mockResolvedValue([latest]);
  const unrelated = { ...rowsToInboxEntries([latest])[0], partnerPubkey: 'carol' };
  let inbox = [...rowsToInboxEntries([latest]), unrelated];
  const before = inbox;
  const setter = (update: React.SetStateAction<DmInboxEntry[]>) => {
    inbox = typeof update === 'function' ? update(inbox) : update;
  };
  renderHook(() => useMarmotDmInbound('alice', setter));
  await act(async () => {
    mockOnMessage(deletion);
    await jest.advanceTimersByTimeAsync(150);
  });
  expect(deleteMarmotMessages).toHaveBeenCalledWith('alice', 'bob', [id], 'bob');
  // Perf: no follow-up read, no state update, no thread reload.
  expect(getConversationMessages).not.toHaveBeenCalled();
  expect(inbox).toBe(before);
  expect(notifyDmMessage).not.toHaveBeenCalled();
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
  (deleteMarmotMessages as jest.Mock).mockResolvedValueOnce([id]);
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

const chat = (msgId: string, sender: string, created_at = 3) =>
  ({
    ...deletion,
    rumor: { id: msgId, kind: 9, pubkey: sender, tags: [], content: 'hi', created_at },
  }) as MarmotMessageEvent;

it('still applies removals when the batch upsert fails', async () => {
  (upsertDmMessages as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  renderHook(() => useMarmotDmInbound('alice', jest.fn()));
  await act(async () => {
    mockOnMessage(chat('b'.repeat(64), 'bob'));
    mockOnMessage(deletion);
    await jest.advanceTimersByTimeAsync(150);
  });
  expect(upsertDmMessages).toHaveBeenCalled();
  expect(deleteMarmotMessages).toHaveBeenCalledWith('alice', 'bob', [id], 'bob');
});

it('blocks a replayed message after remount with one tombstone query per flush', async () => {
  const { unmount } = renderHook(() => useMarmotDmInbound('alice', jest.fn()));
  await act(async () => {
    mockOnMessage(deletion);
    await jest.advanceTimersByTimeAsync(150);
  });
  unmount();
  renderHook(() => useMarmotDmInbound('alice', jest.fn()));
  const db = await getLocalDb();
  const spy = jest.spyOn(db, 'execute');
  await act(async () => {
    mockOnMessage(chat(id, 'bob'));
    for (let i = 0; i < 20; i++) mockOnMessage(chat(i.toString(16).padStart(64, '0'), 'bob'));
    await jest.advanceTimersByTimeAsync(150);
  });
  const lookups = spy.mock.calls.filter(([sql]) => String(sql).includes('FROM marmot_deletions'));
  expect(lookups).toHaveLength(1);
  const stored = (upsertDmMessages as jest.Mock).mock.calls.flatMap(([rows]) => rows);
  expect(stored).toHaveLength(20);
  expect(stored.some((r: DmMessageRow) => r.eventId === id)).toBe(false);
  spy.mockRestore();
});

it('queries the tray for live deletions at once, and replayed ones in one later sweep', async () => {
  const now = Math.floor(Date.now() / 1000);
  renderHook(() => useMarmotDmInbound('alice', jest.fn()));
  const tray = () =>
    (retractMarmotMessageNotifications as jest.Mock).mock.calls.filter(([, o]) => o.tray);
  await act(async () => {
    for (let i = 0; i < 30; i++) {
      const target = i.toString(16).padStart(64, '0');
      mockOnMessage({
        ...deletion,
        rumor: { ...deletion.rumor, id: `old${i}`, tags: [['e', target]], created_at: 1 },
      });
    }
    mockOnMessage({ ...deletion, rumor: { ...deletion.rumor, created_at: now } });
    await jest.advanceTimersByTimeAsync(150);
  });
  // Every deletion cancels in-flight notifications (in memory)…
  expect(retractMarmotMessageNotifications).toHaveBeenCalledTimes(31 + tray().length);
  // …but only the live one has hit the tray so far.
  expect(tray()).toHaveLength(1);
  expect(tray()[0][0]).toEqual([{ owner: 'alice', groupId: 'g', messageId: id, sender: 'bob' }]);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(3000);
  });
  expect(tray()).toHaveLength(2);
  expect(tray()[1][0]).toHaveLength(30);
});
