// NIP-17 chat reactions (#1319, #1321) end to end over the real store SQL:
// the app schema (localDb.ts) on Node's built-in SQLite.
jest.mock('@op-engineering/op-sqlite', () =>
  require('./testUtils/nodeSqliteOpSqlite').nodeSqliteOpSqlite(),
);
jest.mock('./localDbKey', () => ({
  getOrCreateLocalDbKey: jest.fn(() => Promise.resolve('k')),
  clearLocalDbKey: jest.fn(() => Promise.resolve()),
}));

import {
  getConversationMessages,
  getInboxLatest,
  hasConversationWith,
  upsertDmMessages,
  type DmMessageRow,
} from './dmDb';
import { getLocalDb } from './localDb';
import { nip17ReactionSource, type ChatRumor } from './nip17ReactionSource';
import { directMessageRumorEventId } from './dmRumorId';
import { serializeChatReactionRumor } from '../utils/nip17Reactions';

const ME = 'a'.repeat(64);
const PEER = 'b'.repeat(64);
const STRANGER = 'c'.repeat(64);
const MSG = '1'.repeat(64);

const message: DmMessageRow = {
  owner: ME,
  eventId: 'wrap-msg',
  conversation: PEER,
  createdAt: 100,
  sender: ME,
  content: 'hello',
  fromMe: true,
  wireKind: 14,
  rumorId: MSG,
};

/** A decrypted wrapped rumor as the DM ingest stores it. */
function storedRumorRow(rumor: ChatRumor, wrapId: string): DmMessageRow {
  const fromMe = rumor.pubkey === ME;
  return {
    owner: ME,
    eventId: wrapId,
    conversation: PEER,
    createdAt: rumor.created_at,
    sender: rumor.pubkey,
    content: serializeChatReactionRumor(rumor),
    fromMe,
    wireKind: rumor.kind,
    rumorId: directMessageRumorEventId(rumor),
  };
}

const reaction = (pubkey: string, emoji: string, at = 200): ChatRumor => ({
  kind: 7,
  pubkey,
  created_at: at,
  content: emoji,
  tags: [
    ['e', MSG],
    ['p', ME],
    ['k', '14'],
  ],
});

function makeDeps() {
  const sendRumor = jest.fn(async (_rumor: ChatRumor) => true);
  const publicReactions = {
    fetchReactionsForMessages: jest.fn(async (_ids: string[]) => [] as never[]),
    fetchReactionDeletions: jest.fn(async (_ids: string[]) => [] as never[]),
    deleteReaction: jest.fn(async (_id: string) => true),
  };
  return { myPubkey: ME, peerPubkey: PEER, sendRumor, publicReactions };
}

async function allRows(): Promise<Record<string, unknown>[]> {
  const db = await getLocalDb();
  return (await db.execute('SELECT * FROM dm_messages ORDER BY created_at;')).rows ?? [];
}

beforeEach(async () => {
  const db = await getLocalDb();
  await db.execute('DELETE FROM dm_messages;');
  await upsertDmMessages([message]);
});

describe('reading wrapped reactions', () => {
  it('returns a stored peer reaction for its target and ignores strangers', async () => {
    const peerReaction = reaction(PEER, '🎉');
    await upsertDmMessages([
      storedRumorRow(peerReaction, 'wrap-r1'),
      storedRumorRow(reaction(STRANGER, '💩'), 'wrap-r2'),
    ]);
    const source = nip17ReactionSource(makeDeps());

    const events = await source.fetchReactionsForMessages([MSG]);

    expect(events).toEqual([
      expect.objectContaining({
        id: directMessageRumorEventId(peerReaction),
        pubkey: PEER,
        kind: 7,
        content: '🎉',
      }),
    ]);
    expect(await source.fetchReactionsForMessages(['2'.repeat(64)])).toEqual([]);
  });

  it('keeps reaction rows out of the thread, the inbox and the trust check', async () => {
    const db = await getLocalDb();
    await db.execute('DELETE FROM dm_messages;');
    await upsertDmMessages([storedRumorRow(reaction(PEER, '🎉', 300), 'wrap-r1')]);

    expect(await getConversationMessages(ME, PEER, { protocol: 'nip17' })).toEqual([]);
    expect(await getInboxLatest(ME)).toEqual([]);
    expect(await hasConversationWith(ME, PEER)).toBe(false);

    // A real message later is still the thread's latest, not the reaction.
    await upsertDmMessages([message]);
    expect((await getInboxLatest(ME)).map((r) => r.eventId)).toEqual(['wrap-msg']);
  });

  it('returns stored reactions at once and streams public ones from older builds', async () => {
    const legacy = {
      id: '9'.repeat(64),
      pubkey: PEER,
      kind: 7,
      content: '👍',
      created_at: 150,
      tags: [['e', MSG]],
    };
    const stranger = { ...legacy, id: '8'.repeat(64), pubkey: STRANGER };
    const retraction = {
      id: '7'.repeat(64),
      pubkey: PEER,
      created_at: 160,
      tags: [['e', legacy.id]],
    };
    await upsertDmMessages([storedRumorRow(reaction(PEER, '🎉'), 'wrap-r1')]);
    const deps = makeDeps();
    let answerRelays!: (events: never[]) => void;
    deps.publicReactions.fetchReactionsForMessages.mockReturnValueOnce(
      new Promise((resolve) => (answerRelays = resolve)),
    );
    deps.publicReactions.fetchReactionDeletions.mockResolvedValueOnce([retraction] as never[]);
    const source = nip17ReactionSource(deps);
    const live: { kind: number; id: string }[] = [];
    const unsubscribe = source.subscribe((e) => live.push({ kind: e.kind, id: e.id }));

    // The relays haven't answered, yet the stored reaction is already back.
    expect((await source.fetchReactionsForMessages([MSG])).map((e) => e.content)).toEqual(['🎉']);

    answerRelays([legacy, stranger] as never[]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(live).toEqual([
      { kind: 7, id: legacy.id },
      { kind: 5, id: retraction.id },
    ]);
    expect(deps.publicReactions.fetchReactionDeletions).toHaveBeenCalledWith([legacy.id]);
    unsubscribe();
  });

  it('keeps stored reactions when the relay read fails', async () => {
    await upsertDmMessages([storedRumorRow(reaction(PEER, '🎉'), 'wrap-r1')]);
    const deps = makeDeps();
    deps.publicReactions.fetchReactionsForMessages.mockRejectedValueOnce(new Error('timeout'));
    const source = nip17ReactionSource(deps);
    expect((await source.fetchReactionsForMessages([MSG])).map((e) => e.content)).toEqual(['🎉']);
  });

  it('returns wrapped retractions that name a reaction', async () => {
    const r = reaction(PEER, '🎉');
    const rId = directMessageRumorEventId(r);
    const retraction: ChatRumor = {
      kind: 5,
      pubkey: PEER,
      created_at: 250,
      content: '',
      tags: [
        ['e', rId],
        ['k', '7'],
      ],
    };
    await upsertDmMessages([storedRumorRow(r, 'wrap-r1'), storedRumorRow(retraction, 'wrap-d1')]);
    const source = nip17ReactionSource(makeDeps());

    expect(await source.fetchReactionDeletions([rId])).toEqual([
      expect.objectContaining({ kind: 5, pubkey: PEER, tags: retraction.tags }),
    ]);
    expect(await source.fetchReactionDeletions(['7'.repeat(64)])).toEqual([]);
  });
});

describe('sending', () => {
  it('gift-wraps a kind-7 rumor and keeps a local row until the echo replaces it', async () => {
    const deps = makeDeps();
    const source = nip17ReactionSource(deps);

    const id = await source.publishReaction({
      emoji: '❤️',
      targetEventId: MSG,
      targetAuthorPubkey: ME,
      targetEventKind: 14,
    });

    const sent = deps.sendRumor.mock.calls[0][0];
    expect(sent).toMatchObject({ kind: 7, pubkey: ME, content: '❤️' });
    // Our own message: the author `p`, then the peer's so other devices can place it.
    expect(sent.tags).toEqual([
      ['e', MSG],
      ['p', ME],
      ['p', PEER],
      ['k', '14'],
    ]);
    expect(id).toBe(directMessageRumorEventId(sent));
    expect((await allRows()).map((r) => r.event_id)).toEqual(['wrap-msg', `local-${id}`]);
    expect(deps.publicReactions.deleteReaction).not.toHaveBeenCalled();

    // The relay echo of our self-copy replaces the local row.
    await upsertDmMessages([storedRumorRow(sent, 'wrap-echo')]);
    expect((await allRows()).map((r) => r.event_id)).toEqual(['wrap-msg', 'wrap-echo']);
    expect(await source.fetchReactionsForMessages([MSG])).toEqual([
      expect.objectContaining({ id, pubkey: ME, content: '❤️' }),
    ]);
  });

  it('drops the local row and reports failure when no relay accepts the wrap', async () => {
    const deps = makeDeps();
    deps.sendRumor.mockResolvedValueOnce(false);
    const source = nip17ReactionSource(deps);

    expect(
      await source.publishReaction({ emoji: '❤️', targetEventId: MSG, targetAuthorPubkey: PEER }),
    ).toBeNull();
    expect((await allRows()).map((r) => r.event_id)).toEqual(['wrap-msg']);
  });

  it('retracts with a wrapped kind 5, and also publicly for an older public reaction', async () => {
    const legacyId = '9'.repeat(64);
    const deps = makeDeps();
    deps.publicReactions.fetchReactionsForMessages.mockResolvedValueOnce([
      { id: legacyId, pubkey: ME, kind: 7, content: '👍', created_at: 1, tags: [['e', MSG]] },
    ] as never[]);
    const source = nip17ReactionSource(deps);
    const wrappedId = 'f'.repeat(64);

    expect(await source.deleteReaction(wrappedId)).toBe(true);
    expect(deps.sendRumor.mock.calls[0][0]).toMatchObject({
      kind: 5,
      tags: [
        ['e', wrappedId],
        ['k', '7'],
        ['p', PEER],
      ],
    });
    expect(deps.publicReactions.deleteReaction).not.toHaveBeenCalled();

    await source.fetchReactionsForMessages([MSG]);
    await new Promise((resolve) => setTimeout(resolve, 10)); // public read settles
    expect(await source.deleteReaction(legacyId)).toBe(true);
    expect(deps.publicReactions.deleteReaction).toHaveBeenCalledWith(legacyId);
  });
});

describe('live', () => {
  it('emits only reactions stored after subscribing', async () => {
    await upsertDmMessages([storedRumorRow(reaction(PEER, '🎉'), 'wrap-old')]);
    const source = nip17ReactionSource(makeDeps());
    const seen: string[] = [];
    const unsubscribe = source.subscribe((e) => seen.push(e.content));

    await upsertDmMessages([storedRumorRow(reaction(PEER, '🔥', 300), 'wrap-new')]);
    await upsertDmMessages([storedRumorRow(reaction(STRANGER, '💩', 301), 'wrap-x')]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).toEqual(['🔥']);

    unsubscribe();
    await upsertDmMessages([storedRumorRow(reaction(PEER, '😮', 400), 'wrap-late')]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).toEqual(['🔥']);
  });
});
