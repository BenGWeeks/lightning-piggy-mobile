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
  wasDmRowDeleted,
  type DmMessageRow,
} from './dmDb';
import { keepPendingLocalRows } from '../contexts/nostrDmCache';
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

describe('our own sends (#1237): a `local-` row carrying the Marmot id as rumor id', () => {
  const MINE = 'a'.repeat(64);
  const mine = (over: Partial<DmMessageRow> = {}) =>
    row({
      eventId: `local-${MINE}`,
      rumorId: MINE,
      sender: 'me',
      fromMe: true,
      content: 'typo',
      createdAt: 10,
      ...over,
    });
  const myEdit = (content: string, editedAt: number) => ({
    ...edit(content, editedAt, 'x', 'me'),
    target: MINE,
  });
  const mineStored = async () =>
    (await getConversationMessages('me', 'peer', { limit: 10, protocol: 'marmot' })).filter(
      (r) => r.fromMe,
    );

  beforeEach(async () => {
    await upsertDmMessages([mine()]);
  });

  it('an edit to the Marmot id reaches the local row', async () => {
    expect(await applyMarmotEdits('me', [myEdit('fixed', 20)])).toHaveLength(1);
    expect(await mineStored()).toMatchObject([{ eventId: `local-${MINE}`, content: 'fixed' }]);
  });

  it('a delete of the Marmot id removes the local row, returning its row id', async () => {
    expect(await deleteMarmotMessages('me', 'peer', [MINE], 'me')).toEqual([`local-${MINE}`]);
    expect(await mineStored()).toEqual([]);
  });

  it('an open thread drops the deleted local row on reload instead of keeping it as pending', async () => {
    const OWN = 'c'.repeat(64); // its own id: the deleted-row registry lives for the session
    await upsertDmMessages([mine({ eventId: `local-${OWN}`, rumorId: OWN, content: 'oops' })]);
    const onScreen = { id: `local-${OWN}`, fromMe: true, text: 'oops', createdAt: 10 };
    const other = { id: 'x1', fromMe: false, text: 'hi', createdAt: 5 };
    // Before any delete: a local row a stale fetch lacks is kept (still sending).
    expect(keepPendingLocalRows([onScreen], [other]).map((m) => m.id)).toEqual([
      'x1',
      `local-${OWN}`,
    ]);
    await deleteMarmotMessages('me', 'peer', [OWN], 'peer'); // not the author: nothing removed
    expect(wasDmRowDeleted(`local-${OWN}`)).toBe(false);
    await deleteMarmotMessages('me', 'peer', [OWN], null); // an admin removal from the peer
    expect(wasDmRowDeleted(`local-${OWN}`)).toBe(true);
    expect(keepPendingLocalRows([onScreen], [other]).map((m) => m.id)).toEqual(['x1']);
  });

  it('the replayed original still retires the edited local row (no duplicate), then the edit replays', async () => {
    await applyMarmotEdits('me', [myEdit('fixed', 20)]);
    await upsertDmMessages([mine({ eventId: MINE })]); // history replay: original text 'typo'
    expect((await mineStored()).map((r) => r.eventId)).toEqual([MINE]);
    await applyMarmotEdits('me', [myEdit('fixed', 20)]);
    expect(await mineStored()).toMatchObject([{ eventId: MINE, content: 'fixed', editedAt: 20 }]);
  });
});
