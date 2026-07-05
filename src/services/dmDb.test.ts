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
  importDmMessages,
  updateDmDeliveryStatuses,
  getConversationMessages,
  getInboxLatest,
  selectDmWrapIds,
  hasStoredWraps,
  hasConversationWith,
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

    it('upserts received rows in one transaction, keeping any existing tick (COALESCE)', async () => {
      await upsertDmMessages([row({ eventId: 'e1' }), row({ eventId: 'e2' })]);
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      // Received (fromMe=false) rows skip the local-echo lookup → one
      // statement per row.
      expect(mockExecute).toHaveBeenCalledTimes(2);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('INSERT INTO dm_messages');
      expect(sql).toContain('ON CONFLICT(owner, event_id) DO UPDATE');
      expect(sql).toContain('COALESCE(excluded.delivery_status, dm_messages.delivery_status)');
      expect(sql).toContain('COALESCE(excluded.rumor_id, dm_messages.rumor_id)');
      expect(params).toEqual([OWNER, 'e1', 'convA', 100, 's1', 'hi', 0, 14, null, null]);
    });

    it('serialises deliveryStatus / rumorId onto optimistic local- rows (#850)', async () => {
      const status = { delivered: true, relayResults: { 'wss://r': 'ok' as const } };
      await upsertDmMessages([
        row({ eventId: 'local-1', fromMe: true, deliveryStatus: status, rumorId: 'rum1' }),
      ]);
      // local- rows never echo-match themselves (the lookup is skipped for
      // local- ids), so a single INSERT.
      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [, params] = mockExecute.mock.calls[0];
      expect(params[8]).toBe(JSON.stringify(status));
      expect(params[9]).toBe('rum1');
    });

    it('retires the matched local- row when its echo lands, inheriting tick + rumorId', async () => {
      const status = { delivered: true, relayResults: {} };
      // Echo lookup returns the pending local- row for this send.
      mockExecute.mockResolvedValueOnce(
        rowsResult([
          {
            event_id: 'local-42',
            delivery_status: JSON.stringify(status),
            rumor_id: 'rum42',
            created_at: 99,
          },
        ]),
      );
      await upsertDmMessages([row({ eventId: 'wrap42', fromMe: true, createdAt: 100 })]);
      // SELECT (echo lookup) + DELETE (retire local-) + INSERT (echo row)
      expect(mockExecute).toHaveBeenCalledTimes(3);
      const [selectSql, selectParams] = mockExecute.mock.calls[0];
      expect(selectSql).toContain(`event_id LIKE 'local-%'`);
      expect(selectSql).toContain('from_me = 1');
      // Sargable window (Copilot #990): BETWEEN, not ABS(created_at - ?).
      expect(selectSql).toContain('created_at BETWEEN ? - 30 AND ? + 30');
      expect(selectParams).toEqual([OWNER, 'convA', 'hi', 100, 100]);
      const [deleteSql, deleteParams] = mockExecute.mock.calls[1];
      expect(deleteSql).toContain('DELETE FROM dm_messages');
      expect(deleteParams).toEqual([OWNER, 'local-42']);
      const [, insertParams] = mockExecute.mock.calls[2];
      expect(insertParams[1]).toBe('wrap42');
      expect(insertParams[8]).toBe(JSON.stringify(status)); // inherited tick
      expect(insertParams[9]).toBe('rum42'); // inherited rumorId
    });

    it('does not retire a local- row outside the echo window', async () => {
      // Lookup returns nothing (the SQL window filter excluded it) → no DELETE.
      await upsertDmMessages([row({ eventId: 'wrap43', fromMe: true, createdAt: 100 })]);
      expect(mockExecute).toHaveBeenCalledTimes(2); // SELECT + INSERT, no DELETE
    });
  });

  describe('importDmMessages (blob migration, #850)', () => {
    it('no-ops on empty input', async () => {
      await importDmMessages([]);
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('fill-only: the EXISTING row wins; import only supplies a missing tick/rumorId', async () => {
      const status = { delivered: true, relayResults: {} };
      await importDmMessages([row({ eventId: 'e1', deliveryStatus: status, rumorId: 'r1' })]);
      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0];
      // Reversed COALESCE order vs upsert: dm_messages (existing) first.
      expect(sql).toContain('COALESCE(dm_messages.delivery_status, excluded.delivery_status)');
      expect(sql).toContain('COALESCE(dm_messages.rumor_id, excluded.rumor_id)');
      expect(params[8]).toBe(JSON.stringify(status));
      expect(params[9]).toBe('r1');
    });
  });

  describe('updateDmDeliveryStatuses (#856 tick persist, #850 store-backed)', () => {
    it('no-ops on an empty map', async () => {
      await updateDmDeliveryStatuses(OWNER, {});
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('fills only rows without an existing status (delivery_status IS NULL)', async () => {
      const status = { delivered: true, relayResults: {} };
      await updateDmDeliveryStatuses(OWNER, { e1: status });
      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('UPDATE dm_messages SET delivery_status = ?');
      expect(sql).toContain('delivery_status IS NULL');
      expect(params).toEqual([JSON.stringify(status), OWNER, 'e1']);
    });
  });

  describe('hasConversationWith (#850 order-trust check)', () => {
    it('is true when any row exists for (owner, conversation)', async () => {
      mockExecute.mockResolvedValueOnce(rowsResult([{ present: 1 }]));
      expect(await hasConversationWith(OWNER, 'convA')).toBe(true);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('WHERE owner = ? AND conversation = ? LIMIT 1');
      expect(params).toEqual([OWNER, 'convA']);
    });

    it('is false when no row exists', async () => {
      expect(await hasConversationWith(OWNER, 'convZ')).toBe(false);
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

    it('parses delivery_status JSON + rumor_id off the row; corrupt JSON degrades to none', async () => {
      const status = { delivered: true, relayResults: {} };
      mockExecute.mockResolvedValueOnce(
        rowsResult([
          {
            owner: OWNER,
            event_id: 'sent1',
            conversation: 'convA',
            created_at: 300,
            sender: OWNER,
            content: 'yo',
            from_me: 1,
            wire_kind: 14,
            delivery_status: JSON.stringify(status),
            rumor_id: 'rumX',
          },
          {
            owner: OWNER,
            event_id: 'sent2',
            conversation: 'convA',
            created_at: 301,
            sender: OWNER,
            content: 'yo2',
            from_me: 1,
            wire_kind: 14,
            delivery_status: '{corrupt',
            rumor_id: null,
          },
        ]),
      );
      const out = await getConversationMessages(OWNER, 'convA');
      expect(out[0].deliveryStatus).toEqual(status);
      expect(out[0].rumorId).toBe('rumX');
      expect(out[1].deliveryStatus).toBeUndefined();
      expect(out[1].rumorId).toBeUndefined();
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
    it('returns NIP-17 wrap ids only (kind-4 + optimistic local- rows excluded)', async () => {
      mockExecute.mockResolvedValueOnce(rowsResult([{ event_id: 'w1' }, { event_id: 'w2' }]));
      const out = await selectDmWrapIds(OWNER);
      expect(out).toEqual(['w1', 'w2']);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('wire_kind != 4');
      expect(sql).toContain(`event_id NOT LIKE 'local-%'`);
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
      // A first-ever optimistic send must not fake a completed ingest (#850).
      expect(sql).toContain(`event_id NOT LIKE 'local-%'`);
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
