// Runs the real schema (localDb.ts) and the real SQL against Node's built-in
// SQLite, standing in for op-sqlite's SQLCipher build (same SQL dialect).
jest.mock('@op-engineering/op-sqlite', () =>
  require('./testUtils/nodeSqliteOpSqlite').nodeSqliteOpSqlite(),
);
jest.mock('./localDbKey', () => ({
  getOrCreateLocalDbKey: jest.fn(() => Promise.resolve('k')),
  clearLocalDbKey: jest.fn(() => Promise.resolve()),
}));

import { getLocalDb } from './localDb';
import {
  TOMBSTONES_PER_DELETER,
  TOMBSTONES_PER_GROUP,
  deletedMarmotMessages,
  forgetMarmotDeletionsForGroup,
  forgetMarmotDeletionsForOwner,
  isMarmotDeleted,
  marmotMessageKey,
  rememberMarmotDeletions,
} from './marmotDeletionStore';

const del = (targets: string[], deleter: string, anyAuthor = false) => ({
  targets,
  deleter,
  anyAuthor,
});
const count = async (where = '1 = 1', params: string[] = []) => {
  const db = await getLocalDb();
  const res = await db.execute(
    `SELECT COUNT(*) AS n FROM marmot_deletions WHERE ${where};`,
    params,
  );
  return Number(res.rows?.[0]?.n);
};

beforeEach(async () => {
  const db = await getLocalDb();
  await db.execute('DELETE FROM marmot_deletions;');
});

it('hides only the deleter’s own messages, or anyone’s for an admin removal', async () => {
  await rememberMarmotDeletions('owner', [{ scope: 'g', deletion: del(['t'], 'alice') }]);
  expect(await isMarmotDeleted('owner', 'g', 't', 'alice')).toBe(true);
  expect(await isMarmotDeleted('owner', 'g', 't', 'carol')).toBe(false);
  expect(await isMarmotDeleted('owner', 'g2', 't', 'alice')).toBe(false); // other group
  expect(await isMarmotDeleted('other', 'g', 't', 'alice')).toBe(false); // other account
  await rememberMarmotDeletions('owner', [{ scope: 'g', deletion: del(['t'], 'admin', true) }]);
  expect(await isMarmotDeleted('owner', 'g', 't', 'carol')).toBe(true);
});

it('keeps every deleter and makes admin authority stick (a later delete never overwrites)', async () => {
  await rememberMarmotDeletions('owner', [
    { scope: 'g', deletion: del(['t'], 'alice') },
    { scope: 'g', deletion: del(['t'], 'mallory') },
  ]);
  expect(await isMarmotDeleted('owner', 'g', 't', 'alice')).toBe(true);
  await rememberMarmotDeletions('owner', [{ scope: 'g', deletion: del(['u'], 'admin', true) }]);
  await rememberMarmotDeletions('owner', [{ scope: 'g', deletion: del(['u'], 'admin') }]);
  expect(await isMarmotDeleted('owner', 'g', 'u', 'bob')).toBe(true);
});

it('checks a whole batch in one query per 500 ids, case-insensitively', async () => {
  await rememberMarmotDeletions('owner', [{ scope: 'g', deletion: del(['aa', 'bb'], 'alice') }]);
  const db = await getLocalDb();
  const spy = jest.spyOn(db, 'execute');
  const hit = await deletedMarmotMessages('owner', [
    { scope: 'g', id: 'AA', sender: 'ALICE' },
    { scope: 'g', id: 'bb', sender: 'carol' },
    { scope: 'g', id: 'cc', sender: 'alice' },
  ]);
  expect([...hit]).toEqual([marmotMessageKey('g', 'aa')]);
  expect(spy).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});

it('caps what one deleter can store, so a flood only evicts their own oldest tombstones', async () => {
  await rememberMarmotDeletions('owner', [{ scope: 'g', deletion: del(['keep'], 'alice') }]);
  const flood = Array.from({ length: TOMBSTONES_PER_DELETER + 50 }, (_, i) => `x${i}`);
  await rememberMarmotDeletions('owner', [{ scope: 'g', deletion: del(flood, 'mallory') }]);
  expect(await count('deleter = ?', ['mallory'])).toBe(TOMBSTONES_PER_DELETER);
  expect(await isMarmotDeleted('owner', 'g', 'x0', 'mallory')).toBe(false); // oldest evicted
  expect(await isMarmotDeleted('owner', 'g', `x${flood.length - 1}`, 'mallory')).toBe(true);
  expect(await isMarmotDeleted('owner', 'g', 'keep', 'alice')).toBe(true);
});

it('caps each group', async () => {
  const deleters = Math.ceil(TOMBSTONES_PER_GROUP / TOMBSTONES_PER_DELETER) + 1;
  for (let d = 0; d < deleters; d++) {
    const ids = Array.from({ length: TOMBSTONES_PER_DELETER }, (_, i) => `${d}-${i}`);
    await rememberMarmotDeletions('owner', [{ scope: 'g', deletion: del(ids, `m${d}`) }]);
  }
  expect(await count('scope = ?', ['g'])).toBe(TOMBSTONES_PER_GROUP);
});

it('forgets a left group, and everything at sign-out', async () => {
  await rememberMarmotDeletions('owner', [
    { scope: 'g', deletion: del(['t'], 'alice') },
    { scope: 'h', deletion: del(['t'], 'alice') },
  ]);
  await rememberMarmotDeletions('other', [{ scope: 'g', deletion: del(['t'], 'alice') }]);
  await forgetMarmotDeletionsForGroup('owner', 'g');
  expect(await isMarmotDeleted('owner', 'g', 't', 'alice')).toBe(false);
  expect(await isMarmotDeleted('owner', 'h', 't', 'alice')).toBe(true);
  await forgetMarmotDeletionsForOwner('owner');
  expect(await count('owner = ?', ['owner'])).toBe(0);
  expect(await isMarmotDeleted('other', 'g', 't', 'alice')).toBe(true);
});
