import { marmotReactionSource } from './marmotReactions';
import { setMarmotSession, type MarmotRumor, type MarmotSession } from './marmotSession';

const ME = 'a'.repeat(64);
const PEER = 'b'.repeat(64);
const rumor = (id: string, kind: number, tags: string[][] = [], content = ''): MarmotRumor => ({
  id,
  pubkey: PEER,
  created_at: 1,
  kind,
  tags,
  content,
});

// Two DMs with the same peer: g-new (newest) and g-old (they reinstalled).
const history: Record<string, MarmotRumor[]> = {
  'g-new': [
    rumor('m-new', 9, [], 'hi again'),
    rumor('r-new', 7, [['e', 'm-new']], '👍'),
    rumor('r-unrelated', 7, [['e', 'm-other']], '😂'),
  ],
  'g-old': [rumor('m-old', 9, [], 'hi'), rumor('r-old', 7, [['e', 'm-old']], '🐷')],
};

function fakeSession() {
  const listeners: ((e: unknown) => void)[] = [];
  const session = {
    pubkey: ME,
    stop: jest.fn(),
    dmGroupIdsWith: jest.fn(async () => ['g-new', 'g-old']),
    queryHistory: jest.fn(async (id: string, kinds?: number[]) =>
      (history[id] ?? []).filter((r) => !kinds || kinds.includes(r.kind)),
    ),
    sendRumor: jest.fn(async () => ({ 'wss://r': true })),
    subscribe: jest.fn((l: { onMessage: (e: unknown) => void }) => {
      listeners.push(l.onMessage);
      return () => undefined;
    }),
    emit: (e: unknown) => listeners.forEach((l) => l(e)),
  };
  return session;
}

afterEach(() => setMarmotSession(null));

describe('marmotReactionSource', () => {
  it('reads reactions to the given messages across every DM with the peer, and only those', async () => {
    setMarmotSession(fakeSession() as unknown as MarmotSession);
    const source = marmotReactionSource(ME, PEER);
    const found = await source.fetchReactionsForMessages(['m-new', 'm-old']);
    expect(found.map((r) => r.id).sort()).toEqual(['r-new', 'r-old']);
  });

  it('sends a reaction into the group holding the message (an older DM included)', async () => {
    const session = fakeSession();
    setMarmotSession(session as unknown as MarmotSession);
    const id = await marmotReactionSource(ME, PEER).publishReaction({
      emoji: '🐷',
      targetEventId: 'm-old',
    });
    expect(id).toEqual(expect.any(String));
    const [groupId, sent] = session.sendRumor.mock.calls[0] as unknown as [string, MarmotRumor];
    expect(groupId).toBe('g-old');
    expect(sent).toMatchObject({ kind: 7, content: '🐷', tags: [['e', 'm-old']] });
  });

  it('keeps live reactions flowing across a session restart', () => {
    const onEvent = jest.fn();
    const unsubscribe = marmotReactionSource(ME, PEER).subscribe(onEvent);
    // Thread opened before Marmot started: attaches once the session appears.
    const first = fakeSession();
    setMarmotSession(first as unknown as MarmotSession);
    const dm = { isDm: true, memberPubkeys: [PEER] };
    first.emit({ group: dm, rumor: rumor('r1', 7, [['e', 'm-new']], '👍') });
    const second = fakeSession();
    setMarmotSession(second as unknown as MarmotSession);
    second.emit({ group: dm, rumor: rumor('r2', 5, [['e', 'r1']]) });
    // Chat text and other people's chats are ignored.
    second.emit({ group: dm, rumor: rumor('m3', 9, [], 'hello') });
    second.emit({ group: { isDm: true, memberPubkeys: ['c'.repeat(64)] }, rumor: rumor('r3', 7) });
    expect(onEvent.mock.calls.map((c) => (c[0] as MarmotRumor).id)).toEqual(['r1', 'r2']);
    unsubscribe();
  });
});
