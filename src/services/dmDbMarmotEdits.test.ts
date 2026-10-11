// The Marmot edit / delete SQL in dmDb, run for real: the app schema
// (localDb.ts) on Node's built-in SQLite, standing in for op-sqlite's SQLCipher
// build (same dialect; RETURNING and UPSERT included).
jest.mock('@op-engineering/op-sqlite', () =>
  require('./testUtils/nodeSqliteOpSqlite').nodeSqliteOpSqlite(),
);
jest.mock('./localDbKey', () => ({
  getOrCreateLocalDbKey: jest.fn(() => Promise.resolve('k')),
  clearLocalDbKey: jest.fn(() => Promise.resolve()),
}));

import {
  applyMarmotEdits,
  deleteMarmotMessages,
  getConversationMessages,
  upsertDmMessages,
  type DmMessageRow,
} from './dmDb';
import { getLocalDb } from './localDb';

const ID = 'd'.repeat(64);
const row = (over: Partial<DmMessageRow> = {}): DmMessageRow => ({
  owner: 'me',
  eventId: ID,
  conversation: 'peer',
  createdAt: 1,
  sender: 'peer',
  content: 'original',
  fromMe: false,
  wireKind: 14,
  protocol: 'marmot',
  ...over,
});
const edit = (content: string, editedAt: number, editId: string, editor = 'peer') => ({
  target: ID,
  content,
  editor,
  editedAt,
  editId,
});
const stored = async () =>
  (await getConversationMessages('me', 'peer', { limit: 10, protocol: 'marmot' }))[0];

beforeEach(async () => {
  await (await getLocalDb()).execute('DELETE FROM dm_messages;');
  await upsertDmMessages([row()]);
});

it('applies only the author’s edit, and reports the conversation it changed', async () => {
  expect(await applyMarmotEdits('me', [edit('forged', 5, 'f', 'mallory')])).toEqual([]);
  const changed = await applyMarmotEdits('me', [edit('v2', 5, 'a')]);
  expect(changed.map((c) => [c.edit.content, c.conversation])).toEqual([['v2', 'peer']]);
  expect(await stored()).toMatchObject({ content: 'v2', editedAt: 5, editId: 'a' });
});

it('settles same-second edits on the higher edit id, in either order', async () => {
  await applyMarmotEdits('me', [edit('v3', 5, 'b')]);
  expect(await applyMarmotEdits('me', [edit('v2', 5, 'a')])).toEqual([]);
  expect((await stored()).content).toBe('v3');
  await applyMarmotEdits('me', [edit('v4', 5, 'c')]);
  expect((await stored()).content).toBe('v4');
});

it('keeps the edit when the original replays, unless the replay carries a newer edit', async () => {
  await applyMarmotEdits('me', [edit('v2', 5, 'b')]);
  await upsertDmMessages([row()]);
  expect((await stored()).content).toBe('v2');
  await upsertDmMessages([row({ content: 'v1-tie-lower', editedAt: 5, editId: 'a' })]);
  expect((await stored()).content).toBe('v2');
  await upsertDmMessages([row({ content: 'v3', editedAt: 5, editId: 'c' })]);
  expect(await stored()).toMatchObject({ content: 'v3', editId: 'c' });
});

it('never edits a non-text row', async () => {
  await upsertDmMessages([row({ eventId: 'e'.repeat(64), wireKind: 15, content: 'file' })]);
  expect(await applyMarmotEdits('me', [{ ...edit('x', 9, 'z'), target: 'e'.repeat(64) }])).toEqual(
    [],
  );
});

it('returns exactly the rows a delete removed (RETURNING)', async () => {
  expect(await deleteMarmotMessages('me', 'peer', [ID], 'mallory')).toEqual([]);
  expect(await deleteMarmotMessages('me', 'peer', [ID, 'f'.repeat(64)], 'peer')).toEqual([ID]);
  expect(await stored()).toBeUndefined();
});
