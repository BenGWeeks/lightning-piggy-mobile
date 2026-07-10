import {
  mapStoredRowsToMessages,
  loadInitialConversation,
  type InitialConversationDeps,
} from './conversationReadThrough';
import type { DmMessageRow } from '../services/dmDb';
import type { ConversationMessage } from './nostrContextTypes';

const PEER = 'a'.repeat(64);

const row = (over: Partial<DmMessageRow> = {}): DmMessageRow => ({
  owner: 'b'.repeat(64),
  eventId: 'evt-1',
  conversation: PEER,
  createdAt: 100,
  sender: PEER,
  content: 'hello from the inbox',
  fromMe: false,
  wireKind: 14,
  ...over,
});

describe('mapStoredRowsToMessages', () => {
  it('projects store rows to the thread message shape', () => {
    const out = mapStoredRowsToMessages([row({ eventId: 'x', content: 'hi', createdAt: 7 })]);
    expect(out).toEqual([{ id: 'x', fromMe: false, text: 'hi', createdAt: 7, wireKind: 14 }]);
  });

  it('carries the delivery tick + rumorId columns (#850)', () => {
    const status = { delivered: true, relayResults: {} };
    const out = mapStoredRowsToMessages([
      row({ eventId: 's1', fromMe: true, deliveryStatus: status, rumorId: 'rum1' }),
    ]);
    expect(out[0].deliveryStatus).toEqual(status);
    expect(out[0].rumorId).toBe('rum1');
  });

  it('returns [] for no rows', () => {
    expect(mapStoredRowsToMessages([])).toEqual([]);
  });
});

describe('loadInitialConversation (read-through #868, store-only #850)', () => {
  it('returns the ingested store message — the store is the single at-rest source', async () => {
    const deps: InitialConversationDeps = {
      getStoredRows: async () => [row({ eventId: 'ingested', content: 'the preview message' })],
    };
    const out = await loadInitialConversation(PEER, deps);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'ingested', text: 'the preview message' });
  });

  it('resolves from the store BEFORE any relay fetch — no relay dependency', async () => {
    // The relay fetch is modelled here as a promise that never resolves; the
    // read-through must not await it. If loadInitialConversation awaited a relay
    // round-trip this test would hang and time out.
    const neverResolves = new Promise<ConversationMessage[]>(() => {});
    const deps: InitialConversationDeps = {
      getStoredRows: async () => [row({ eventId: 'fromStore' })],
    };
    const out = await Promise.race([
      loadInitialConversation(PEER, deps),
      neverResolves.then(() => 'RELAY' as const),
    ]);
    expect(out).not.toBe('RELAY');
    expect((out as ConversationMessage[])[0].id).toBe('fromStore');
  });

  it('collapses a raced local- row + its echo to one bubble, inheriting the tick', async () => {
    // The store-level retire in upsertDmMessages usually removes the local-
    // row when the echo lands, but the optimistic append and the live-sub
    // echo can race — a read may still see both. The read-side dedup keeps
    // one bubble and carries the local- row's tick onto the echo.
    const status = { delivered: true, relayResults: {} };
    const deps: InitialConversationDeps = {
      getStoredRows: async () => [
        row({
          eventId: 'local-1',
          content: 'gm',
          fromMe: true,
          createdAt: 200,
          deliveryStatus: status,
          rumorId: 'rum1',
        }),
        row({ eventId: 'echo-1', content: 'gm', fromMe: true, createdAt: 201 }),
      ],
    };
    const out = await loadInitialConversation(PEER, deps);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('echo-1');
    expect(out[0].deliveryStatus).toEqual(status);
    expect(out[0].rumorId).toBe('rum1');
  });

  it('keeps a pending local- row that has no echo yet', async () => {
    const deps: InitialConversationDeps = {
      getStoredRows: async () => [
        row({ eventId: 'local-pending', content: 'sending…', fromMe: true, createdAt: 300 }),
      ],
    };
    const out = await loadInitialConversation(PEER, deps);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('local-pending');
  });

  it('degrades to an empty paint when the store read throws', async () => {
    const deps: InitialConversationDeps = {
      getStoredRows: async () => {
        throw new Error('db unavailable');
      },
    };
    expect(await loadInitialConversation(PEER, deps)).toEqual([]);
  });
});
