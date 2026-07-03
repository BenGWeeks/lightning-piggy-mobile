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
  selectDmWrapIds,
  hasStoredWraps,
  deleteDmMessagesForOwner,
  type DmMessageRow,
} from './dmDb';

const OWNER = 'owner1';

const row = (over: Partial<DmMessageRow> = {}): DmMessageRow => ({
  owner: OWNER,
  eventId: 'e1',
  conversation: 'convA',
  createdAt: 100,
  sender: 's1',
  content: 'hi',
  fromMe: false,
  wireKind: 14,
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
      expect((await selectKnownEventIds(OWNER, [])).size).toBe(0);
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('returns the set of ids already stored, scoped to the owner', async () => {
      mockExecute.mockResolvedValueOnce(rowsResult([{ event_id: 'a' }, { event_id: 'c' }]));
      const known = await selectKnownEventIds(OWNER, ['a', 'b', 'c']);
      expect([...known].sort()).toEqual(['a', 'c']);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('WHERE owner = ? AND event_id IN (?,?,?)');
      expect(params).toEqual([OWNER, 'a', 'b', 'c']);
    });

    it('chunks large id lists under the SQLite variable limit', async () => {
      const ids = Array.from({ length: 1200 }, (_, i) => `id${i}`);
      await selectKnownEventIds(OWNER, ids);
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
      expect(params).toEqual([OWNER, 'e1', 'convA', 100, 's1', 'hi', 0, 14]);
    });
  });

  describe('getConversationMessages', () => {
    it('reads newest-first with a default limit, mapping rows', async () => {
      mockExecute.mockResolvedValueOnce(
        rowsResult([
          {
            owner: OWNER,
            event_id: 'e2',
            conversation: 'convA',
            created_at: 200,
            sender: 's',
            content: 'b',
            from_me: 1,
            wire_kind: 14,
          },
        ]),
      );
      const out = await getConversationMessages(OWNER, 'convA');
      expect(out).toEqual([
        {
          owner: OWNER,
          eventId: 'e2',
          conversation: 'convA',
          createdAt: 200,
          sender: 's',
          content: 'b',
          fromMe: true,
          wireKind: 14,
        },
      ]);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('WHERE owner = ? AND conversation = ?');
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(params).toEqual([OWNER, 'convA', 50]);
    });

    it('pages backwards with beforeCreatedAt', async () => {
      await getConversationMessages(OWNER, 'convA', { limit: 20, beforeCreatedAt: 150 });
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('created_at < ?');
      expect(params).toEqual([OWNER, 'convA', 150, 20]);
    });
  });

  describe('getInboxLatest', () => {
    it('selects the latest row per conversation (MAX(created_at) join), owner-scoped', async () => {
      mockExecute.mockResolvedValueOnce(
        rowsResult([
          {
            owner: OWNER,
            event_id: 'e9',
            conversation: 'convB',
            created_at: 900,
            sender: 's',
            content: 'z',
          },
        ]),
      );
      const out = await getInboxLatest(OWNER);
      expect(out[0].conversation).toBe('convB');
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('MAX(created_at)');
      expect(sql).toContain('GROUP BY conversation');
      expect(sql).toContain('WHERE m.owner = ?');
      expect(params).toEqual([OWNER, OWNER]);
    });
  });

  describe('selectDmWrapIds', () => {
    it('returns NIP-17 wrap ids only (kind-4 rows excluded)', async () => {
      mockExecute.mockResolvedValueOnce(rowsResult([{ event_id: 'w1' }, { event_id: 'w2' }]));
      const out = await selectDmWrapIds(OWNER);
      expect(out).toEqual(['w1', 'w2']);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('wire_kind != 4');
      expect(params).toEqual([OWNER]);
    });
  });

  describe('hasStoredWraps', () => {
    it('is false on an empty store and true once a wrap row exists', async () => {
      expect(await hasStoredWraps(OWNER)).toBe(false);
      mockExecute.mockResolvedValueOnce(rowsResult([{ present: 1 }]));
      expect(await hasStoredWraps(OWNER)).toBe(true);
      const [sql] = mockExecute.mock.calls[0];
      expect(sql).toContain('LIMIT 1');
      expect(sql).toContain('wire_kind != 4');
    });
  });

  describe('deleteDmMessagesForOwner', () => {
    it("deletes only the owner's rows", async () => {
      await deleteDmMessagesForOwner(OWNER);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('DELETE FROM dm_messages WHERE owner = ?');
      expect(params).toEqual([OWNER]);
    });
  });
});
