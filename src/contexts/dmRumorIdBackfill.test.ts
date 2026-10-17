// The #1320 rumor-id backfill over the real store SQL (localDb.ts schema on
// Node's built-in SQLite).
jest.mock('@op-engineering/op-sqlite', () =>
  require('../services/testUtils/nodeSqliteOpSqlite').nodeSqliteOpSqlite(),
);
jest.mock('../services/localDbKey', () => ({
  getOrCreateLocalDbKey: jest.fn(() => Promise.resolve('k')),
  clearLocalDbKey: jest.fn(() => Promise.resolve()),
}));

import { getConversationMessages, upsertDmMessages, type DmMessageRow } from '../services/dmDb';
import { getLocalDb } from '../services/localDb';
import { rumorEventId, type DecodedRumor } from '../utils/nip17Unwrap';
import type { RawGiftWrapEvent } from '../services/nostrService';
import { backfillThreadRumorIds } from './dmRumorIdBackfill';

const ME = 'a'.repeat(64);
const PEER = 'b'.repeat(64);
const OTHER = 'c'.repeat(64);

const row = (eventId: string, over: Partial<DmMessageRow> = {}): DmMessageRow => ({
  owner: ME,
  eventId,
  conversation: PEER,
  createdAt: 100,
  sender: PEER,
  content: eventId,
  fromMe: false,
  wireKind: 14,
  ...over,
});
const rumorFor = (id: string): DecodedRumor => ({
  pubkey: PEER,
  created_at: 100,
  kind: 14,
  tags: [['p', ME]],
  content: id,
});
const wrap = (id: string) => ({ id }) as unknown as RawGiftWrapEvent;

beforeEach(async () => {
  await (await getLocalDb()).execute('DELETE FROM dm_messages;');
});

it('fills missing rumor ids from the fetched wraps, leaving existing ids alone', async () => {
  await upsertDmMessages([
    row('w-old'),
    row('w-has', { rumorId: 'kept' }),
    row('w-unfetched'),
    row('w-other', { conversation: OTHER }),
  ]);
  const unwrap = jest.fn((w: RawGiftWrapEvent) => rumorFor(w.id));

  const filled = await backfillThreadRumorIds({
    owner: ME,
    conversation: PEER,
    wraps: [wrap('w-old'), wrap('w-has'), wrap('w-other')],
    unwrap,
  });

  expect([...filled]).toEqual([['w-old', rumorEventId(rumorFor('w-old'))]]);
  // Only the thread's id-less rows are decrypted.
  expect(unwrap.mock.calls.map(([w]) => w.id)).toEqual(['w-old']);
  const ids = Object.fromEntries(
    (await getConversationMessages(ME, PEER)).map((r) => [r.eventId, r.rumorId]),
  );
  expect(ids).toEqual({
    'w-old': rumorEventId(rumorFor('w-old')),
    'w-has': 'kept',
    'w-unfetched': undefined,
  });
});

it('skips wraps that no longer decrypt and writes nothing when aborted', async () => {
  await upsertDmMessages([row('w-bad'), row('w-good')]);
  const controller = new AbortController();
  const filled = await backfillThreadRumorIds({
    owner: ME,
    conversation: PEER,
    wraps: [wrap('w-bad'), wrap('w-good')],
    unwrap: (w) => {
      if (w.id === 'w-bad') throw new Error('bad mac');
      controller.abort();
      return rumorFor(w.id);
    },
    signal: controller.signal,
  });
  expect(filled.size).toBe(0);
  expect((await getConversationMessages(ME, PEER)).every((r) => !r.rumorId)).toBe(true);
});
