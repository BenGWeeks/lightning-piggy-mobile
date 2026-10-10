// Test-only stand-in for `@op-engineering/op-sqlite`, backed by Node's built-in
// SQLite (same SQL dialect as the app's bundled SQLCipher build), so tests can
// run the real schema (localDb.ts) and real queries. Use from a mock factory:
//   jest.mock('@op-engineering/op-sqlite', () =>
//     require('./testUtils/nodeSqliteOpSqlite').nodeSqliteOpSqlite());

type Row = Record<string, unknown>;
type Execute = (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>;

export function nodeSqliteOpSqlite() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite');
  let sqlite = new DatabaseSync(':memory:');
  const execute: Execute = async (sql, params = []) =>
    sql.includes('cipher_version')
      ? { rows: [{ cipher_version: 'test' }] }
      : { rows: sqlite.prepare(sql).all(...params) };
  const db = {
    execute,
    transaction: async (fn: (tx: { execute: Execute }) => Promise<void>) => {
      sqlite.exec('BEGIN');
      try {
        await fn({ execute });
        sqlite.exec('COMMIT');
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
    delete: () => {
      sqlite = new DatabaseSync(':memory:');
    },
  };
  return { open: () => db };
}
