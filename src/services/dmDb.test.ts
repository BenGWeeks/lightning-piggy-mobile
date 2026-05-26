// DAL over the encrypted dm_messages table. getLocalDb is mocked with a fake
// op-sqlite DB (execute + transaction) so these cover the SQL/params/mapping
// without the native module — the encrypted open itself is verified on-device
// (localDb / #700).
const mockExecute = jest.fn();
const mockTransaction = jest.fn(
  async (fn: (tx: { execute: typeof mockExecute }) => Promise<void>) => {
    await fn({ execute: mockExecute });
  },
);
jest.mock('./localDb', () => ({
  getLocalDb: jest.fn(() =>
    Promise.resolve({ execute: mockExecute, transaction: mockTransaction }),
  ),
}));

import {
  selectKnownEventIds,
  upsertDmMessages,
  getConversationMessages,
  getInboxLatest,
  type DmMessageRow,
} from './dmDb';

const row = (over: Partial<DmMessageRow> = {}): DmMessageRow => ({
  eventId: 'e1',
  conversation: 'convA',
  createdAt: 100,
  sender: 's1',
  content: 'hi',
  ...over,
});

// op-sqlite shape: { rows: Array<Record<string, Scalar>> }
const rowsResult = (rows: Record<string, unknown>[]) => ({ rows });

beforeEach(() => {
  jest.clearAllMocks();
  mockExecute.mockResolvedValue(rowsResult([]));
});

describe('dmDb', () => {
  describe('selectKnownEventIds', () => {
    it('returns empty set (no query) for an empty input', async () => {
      expect((await selectKnownEventIds([])).size).toBe(0);
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('returns the set of ids already stored', async () => {
      mockExecute.mockResolvedValueOnce(rowsResult([{ event_id: 'a' }, { event_id: 'c' }]));
      const known = await selectKnownEventIds(['a', 'b', 'c']);
      expect([...known].sort()).toEqual(['a', 'c']);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('WHERE event_id IN (?,?,?)');
      expect(params).toEqual(['a', 'b', 'c']);
    });

    it('chunks large id lists under the SQLite variable limit', async () => {
      const ids = Array.from({ length: 1200 }, (_, i) => `id${i}`);
      await selectKnownEventIds(ids);
      // 1200 / 500 → 3 chunked queries
      expect(mockExecute).toHaveBeenCalledTimes(3);
    });
  });

  describe('upsertDmMessages', () => {
    it('no-ops on empty input', async () => {
      await upsertDmMessages([]);
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('upserts each row in a single transaction with INSERT OR REPLACE', async () => {
      await upsertDmMessages([row({ eventId: 'e1' }), row({ eventId: 'e2' })]);
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockExecute).toHaveBeenCalledTimes(2);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('INSERT OR REPLACE INTO dm_messages');
      expect(params).toEqual(['e1', 'convA', 100, 's1', 'hi']);
    });
  });

  describe('getConversationMessages', () => {
    it('reads newest-first with a default limit, mapping rows', async () => {
      mockExecute.mockResolvedValueOnce(
        rowsResult([
          { event_id: 'e2', conversation: 'convA', created_at: 200, sender: 's', content: 'b' },
        ]),
      );
      const out = await getConversationMessages('convA');
      expect(out).toEqual([
        { eventId: 'e2', conversation: 'convA', createdAt: 200, sender: 's', content: 'b' },
      ]);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('WHERE conversation = ?');
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(params).toEqual(['convA', 50]);
    });

    it('pages backwards with beforeCreatedAt', async () => {
      await getConversationMessages('convA', { limit: 20, beforeCreatedAt: 150 });
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('created_at < ?');
      expect(params).toEqual(['convA', 150, 20]);
    });
  });

  describe('getInboxLatest', () => {
    it('selects the latest row per conversation (MAX(created_at) join)', async () => {
      mockExecute.mockResolvedValueOnce(
        rowsResult([
          { event_id: 'e9', conversation: 'convB', created_at: 900, sender: 's', content: 'z' },
        ]),
      );
      const out = await getInboxLatest();
      expect(out[0].conversation).toBe('convB');
      const [sql] = mockExecute.mock.calls[0];
      expect(sql).toContain('MAX(created_at)');
      expect(sql).toContain('GROUP BY conversation');
    });
  });
});
