// Runs marmotStore's SQL against a real SQLite engine (node:sqlite) rather
// than a mock, so the group-history migration's owner query (#1240) is
// checked against the same key layout the session writes.
import { DatabaseSync } from 'node:sqlite';

import { createSqliteMarmotBackend, listMarmotOwnersForGroup } from './marmotStore';

const mockDb = { current: null as DatabaseSync | null };
jest.mock('./localDb', () => ({
  getLocalDb: async () => ({
    execute: async (sql: string, params: (string | number)[] = []) => {
      const stmt = mockDb.current!.prepare(sql);
      return /^\s*select/i.test(sql)
        ? { rows: stmt.all(...params) }
        : (stmt.run(...params), { rows: [] });
    },
  }),
}));

const BIG = 'a'.repeat(64);
const MIDDLE = 'b'.repeat(64);
const LITTLE = 'c'.repeat(64);
const MLS = '31e52344c02cc18837ec88498b8b66a366059ddf0632433640d917b8419d2264';

beforeEach(() => {
  mockDb.current = new DatabaseSync(':memory:');
  // Same table as localDb.ts SCHEMA.
  mockDb.current.exec(`CREATE TABLE marmot_kv (
     owner TEXT NOT NULL, namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
     PRIMARY KEY (owner, namespace, key));`);
});

it('finds owners by group state, history or media keys — and nobody else', async () => {
  await createSqliteMarmotBackend(BIG).set('groups', MLS, '{}'); // live group state
  await createSqliteMarmotBackend(MIDDLE).set(`history:${MLS}`, 'rumor1', '{}'); // left, history kept
  await createSqliteMarmotBackend(LITTLE).set('groups', 'f'.repeat(64), '{}'); // a different group
  await createSqliteMarmotBackend(LITTLE).set('keyPackages', MLS, '{}'); // same key, other namespace

  expect((await listMarmotOwnersForGroup(MLS)).sort()).toEqual([BIG, MIDDLE]);
  expect(await listMarmotOwnersForGroup('0'.repeat(64))).toEqual([]);
});
