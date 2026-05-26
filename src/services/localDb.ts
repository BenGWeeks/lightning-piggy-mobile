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
     content      TEXT NOT NULL,
     from_me      INTEGER NOT NULL DEFAULT 0,
     wire_kind    INTEGER NOT NULL DEFAULT 14
   );`,
  `CREATE INDEX IF NOT EXISTS idx_dm_conversation_created
     ON dm_messages (conversation, created_at DESC);`,
];

let dbPromise: Promise<DB> | null = null;

async function openLocalDb(): Promise<DB> {
  const encryptionKey = await getOrCreateLocalDbKey();
  const db = open({ name: DB_NAME, encryptionKey });
  // Fail loud if SQLCipher isn't actually compiled in: op-sqlite silently
  // ignores `encryptionKey` on a plain-SQLite build, which would write our
  // private DM / transaction rows to disk in cleartext. cipher_version is
  // empty on plain SQLite and non-empty (e.g. "4.14.0 community") under
  // SQLCipher — an empty value means the build regressed, so refuse to open.
  const cipher = await db.execute('PRAGMA cipher_version;');
  if (!String(cipher.rows?.[0]?.cipher_version ?? '')) {
    throw new Error(
      'SQLCipher not active — refusing to open a plaintext DB (cipher_version empty)',
    );
  }
  for (const stmt of SCHEMA) await db.execute(stmt);
  await migrateDmMessagesColumns(db);
  return db;
}

// `CREATE TABLE IF NOT EXISTS` won't add columns to a dm_messages table created
// by an earlier schema version (e.g. a dev build before from_me/wire_kind), so
// add any missing ones explicitly. The table is a rebuildable relay cache, but
// ALTER preserves rows already synced. Idempotent via the table_info check.
async function migrateDmMessagesColumns(db: DB): Promise<void> {
  const info = await db.execute('PRAGMA table_info(dm_messages);');
  const have = new Set((info.rows ?? []).map((c) => String(c.name)));
  if (!have.has('from_me')) {
    await db.execute('ALTER TABLE dm_messages ADD COLUMN from_me INTEGER NOT NULL DEFAULT 0;');
  }
  if (!have.has('wire_kind')) {
    await db.execute('ALTER TABLE dm_messages ADD COLUMN wire_kind INTEGER NOT NULL DEFAULT 14;');
  }
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
 * Dev-only smoke-check (#695 spike): round-trips a row through the opened DB
 * and returns the active SQLCipher cipher version for logging. The
 * SQLCipher-active assertion lives in `openLocalDb` now (every open is
 * guarded); this just exercises an encrypted write/read end-to-end. Guarded
 * to `__DEV__` so it can't be called from production code, and the smoke row
 * is always cleaned up in `finally`.
 */
export async function verifyEncryptedDb(): Promise<string> {
  if (!__DEV__) throw new Error('verifyEncryptedDb is a dev-only diagnostic');
  const db = await getLocalDb(); // openLocalDb already asserted SQLCipher is active
  const res = await db.execute('PRAGMA cipher_version;');
  const cipher = String(res.rows?.[0]?.cipher_version ?? '');
  try {
    await db.execute(
      `INSERT OR REPLACE INTO dm_messages (event_id, conversation, created_at, sender, content)
       VALUES (?, ?, ?, ?, ?);`,
      ['__smoke__', '__smoke__', 0, '__smoke__', 'ok'],
    );
    const back = await db.execute('SELECT content FROM dm_messages WHERE event_id = ?;', [
      '__smoke__',
    ]);
    if (back.rows?.[0]?.content !== 'ok') throw new Error('encrypted round-trip failed');
    return cipher;
  } finally {
    await db.execute('DELETE FROM dm_messages WHERE event_id = ?;', ['__smoke__']).catch(() => {});
  }
}
