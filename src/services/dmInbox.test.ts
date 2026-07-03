const mockGetInboxLatest = jest.fn();
const mockGetConversation = jest.fn();
jest.mock('./dmDb', () => ({
  getInboxLatest: (...args: unknown[]) => mockGetInboxLatest(...args),
  getConversationMessages: (...args: unknown[]) => mockGetConversation(...args),
}));

import { rowsToInboxEntries, loadInboxEntries, loadConversationEntries } from './dmInbox';
import type { DmMessageRow } from './dmDb';

const row = (over: Partial<DmMessageRow> = {}): DmMessageRow => ({
  owner: 'owner1',
  eventId: 'evt1',
  conversation: 'partnerPk',
  createdAt: 100,
  sender: 'partnerPk',
  content: 'hello',
  fromMe: false,
  wireKind: 14,
  ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('dmInbox', () => {
  it('maps a stored row to a DmInboxEntry 1:1 (no pubkey/kind guessing)', () => {
    const [entry] = rowsToInboxEntries([
      row({
        eventId: 'w1',
        conversation: 'bob',
        createdAt: 42,
        content: 'hi',
        fromMe: true,
        wireKind: 15,
      }),
    ]);
    expect(entry).toEqual({
      id: 'w1',
      partnerPubkey: 'bob',
      fromMe: true,
      createdAt: 42,
      text: 'hi',
      wireKind: 15,
    });
  });

  it('preserves fromMe + wireKind straight off the row (the reason we store them)', () => {
    const entries = rowsToInboxEntries([
      row({ eventId: 'a', fromMe: true, wireKind: 14 }),
      row({ eventId: 'b', fromMe: false, wireKind: 4 }),
    ]);
    expect(entries.map((e) => [e.fromMe, e.wireKind])).toEqual([
      [true, 14],
      [false, 4],
    ]);
  });

  it('loadInboxEntries projects getInboxLatest rows', async () => {
    mockGetInboxLatest.mockResolvedValue([row({ eventId: 'x', conversation: 'carol' })]);
    const out = await loadInboxEntries('owner1');
    expect(mockGetInboxLatest).toHaveBeenCalledWith('owner1');
    expect(out).toEqual([
      {
        id: 'x',
        partnerPubkey: 'carol',
        fromMe: false,
        createdAt: 100,
        text: 'hello',
        wireKind: 14,
      },
    ]);
  });

  it('loadConversationEntries forwards pagination opts and projects rows', async () => {
    mockGetConversation.mockResolvedValue([row({ eventId: 'm1' })]);
    const out = await loadConversationEntries('owner1', 'partnerPk', {
      limit: 20,
      beforeCreatedAt: 50,
    });
    expect(mockGetConversation).toHaveBeenCalledWith('owner1', 'partnerPk', {
      limit: 20,
      beforeCreatedAt: 50,
    });
    expect(out[0].id).toBe('m1');
  });
});
