import { open, type DB } from '@op-engineering/op-sqlite';
import { getOrCreateLocalDbKey } from './localDbKey';

// The single encrypted local database (#695). SQLCipher is enabled as the
// op-sqlite compile target (package.json "op-sqlite": { "sqlcipher": true }),
// so passing `encryptionKey` to open() transparently encrypts the whole file
// — content and metadata — with the Keystore-held key (see localDbKey.ts).
// One DB, indexed rows: DM messages (private) plus public cached events.
const DB_NAME = 'lightningpiggy.db';

// Schema v1. One row per event keyed by event_id (unique → dedupe), indexed
// by (conversation, created_at) for paginated slice reads — the whole point
// of moving off the single-blob cache that froze the Messages tab (#695).
// Public cache tables (caches/events/places) land in a later slice; DMs first
// since they cause the freeze and need the encryption.
const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS dm_messages (
     event_id     TEXT PRIMARY KEY,
     conversation TEXT NOT NULL,
     created_at   INTEGER NOT NULL,
     sender       TEXT NOT NULL,
     content      TEXT NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS idx_dm_conversation_created
     ON dm_messages (conversation, created_at DESC);`,
];

let dbPromise: Promise<DB> | null = null;

async function openLocalDb(): Promise<DB> {
  const encryptionKey = await getOrCreateLocalDbKey();
  const db = open({ name: DB_NAME, encryptionKey });
  for (const stmt of SCHEMA) await db.execute(stmt);
  return db;
}

/**
 * The opened, schema-migrated encrypted DB. Single-flight so concurrent
 * callers share one open; cleared on failure so a transient open error
 * (bad key, locked file) can be retried rather than wedging every call.
 */
export function getLocalDb(): Promise<DB> {
  if (!dbPromise) {
    dbPromise = openLocalDb().catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

/**
 * Spike smoke-check (#695 step 0): proves op-sqlite opens an *encrypted* DB
 * cleanly in the dev-client build and round-trips a row. Returns the active
 * SQLCipher cipher version (non-empty string) on success; throws if the
 * native module or SQLCipher target isn't wired up. Call once from a dev
 * build and check the log — not part of normal app flow.
 */
export async function verifyEncryptedDb(): Promise<string> {
  const db = await getLocalDb();
  const res = await db.execute('PRAGMA cipher_version;');
  const cipher = String(res.rows?.[0]?.cipher_version ?? '');
  if (!cipher) throw new Error('SQLCipher not active — cipher_version empty (plain SQLite build?)');
  await db.execute(
    `INSERT OR REPLACE INTO dm_messages (event_id, conversation, created_at, sender, content)
     VALUES (?, ?, ?, ?, ?);`,
    ['__smoke__', '__smoke__', 0, '__smoke__', 'ok'],
  );
  const back = await db.execute('SELECT content FROM dm_messages WHERE event_id = ?;', [
    '__smoke__',
  ]);
  await db.execute('DELETE FROM dm_messages WHERE event_id = ?;', ['__smoke__']);
  if (back.rows?.[0]?.content !== 'ok') throw new Error('encrypted round-trip failed');
  return cipher;
}
