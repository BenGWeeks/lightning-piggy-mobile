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

  it('returns [] for no rows', () => {
    expect(mapStoredRowsToMessages([])).toEqual([]);
  });
});

describe('loadInitialConversation (read-through #868)', () => {
  it('returns the ingested store message even when the per-conversation cache is empty', async () => {
    // This is the bug: the inbox already has the message in the store, but the
    // conversation cache blob is empty, so the thread used to paint nothing.
    const deps: InitialConversationDeps = {
      getCachedConversation: async () => [],
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
      getCachedConversation: async () => [],
      getStoredRows: async () => [row({ eventId: 'fromStore' })],
    };
    const out = await Promise.race([
      loadInitialConversation(PEER, deps),
      neverResolves.then(() => 'RELAY' as const),
    ]);
    expect(out).not.toBe('RELAY');
    expect((out as ConversationMessage[])[0].id).toBe('fromStore');
  });

  it('unions cache (optimistic local- row) with the store, deduping the echo', async () => {
    // Cache carries an optimistic local- send; the store carries the relay echo
    // of the same text. mergeConversationMessages collapses them to one bubble.
    const deps: InitialConversationDeps = {
      getCachedConversation: async () => [
        { id: 'local-1', fromMe: true, text: 'gm', createdAt: 200 },
      ],
      getStoredRows: async () => [
        row({ eventId: 'echo-1', content: 'gm', fromMe: true, createdAt: 201 }),
      ],
    };
    const out = await loadInitialConversation(PEER, deps);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('echo-1');
  });

  it('degrades to the store when the cache read throws', async () => {
    const deps: InitialConversationDeps = {
      getCachedConversation: async () => {
        throw new Error('cache unavailable');
      },
      getStoredRows: async () => [row({ eventId: 'still-here' })],
    };
    const out = await loadInitialConversation(PEER, deps);
    expect(out[0].id).toBe('still-here');
  });

  it('degrades to the cache when the store read throws', async () => {
    const deps: InitialConversationDeps = {
      getCachedConversation: async () => [
        { id: 'cache-only', fromMe: false, text: 'x', createdAt: 1 },
      ],
      getStoredRows: async () => {
        throw new Error('db unavailable');
      },
    };
    const out = await loadInitialConversation(PEER, deps);
    expect(out[0].id).toBe('cache-only');
  });
});
