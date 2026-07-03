import { getLocalDb } from './localDb';

// Data-access layer for the `dm_messages` table in the encrypted local DB
// (#695). One row per decrypted DM, keyed by (owner, event_id) — `owner` is
// the signed-in account's pubkey, so multi-account devices keep each
// identity's rows separate (#848). Replaces the single-blob wrap cache whose
// whole-blob parse + re-decrypt froze the Messages tab for ~52s (see
// docs/DATA_STORAGE.adoc). All reads are indexed slice reads — never "load
// the whole inbox into JS".

export interface DmMessageRow {
  /** Account pubkey this row belongs to — every query is scoped by it. */
  owner: string;
  eventId: string;
  conversation: string;
  createdAt: number;
  sender: string;
  content: string;
  /** True when we authored the message (sender === our pubkey). Stored rather
   * than derived so reads don't need our pubkey threaded through. */
  fromMe: boolean;
  /** The inner rumor / event kind (NIP-17 text = 14, file = 15, legacy NIP-04
   * = 4). Load-bearing: the inbox NIP-04/NIP-17 dedup keys on it. */
  wireKind: number;
}

// SQLite caps bound variables per statement (historically 999). Chunk IN()
// lists well under that.
const VAR_CHUNK = 500;

const toRow = (r: Record<string, unknown>): DmMessageRow => ({
  owner: String(r.owner),
  eventId: String(r.event_id),
  conversation: String(r.conversation),
  createdAt: Number(r.created_at),
  sender: String(r.sender),
  content: String(r.content),
  fromMe: Number(r.from_me) === 1,
  wireKind: Number(r.wire_kind),
});

/**
 * Of the given event ids, which are already stored for this owner. This is
 * the decrypt-once gate: ingest checks this first and only decrypts wraps we
 * haven't seen, instead of re-decrypting the whole inbox on every refresh.
 */
export async function selectKnownEventIds(owner: string, eventIds: string[]): Promise<Set<string>> {
  const known = new Set<string>();
  if (eventIds.length === 0) return known;
  const db = await getLocalDb();
  for (let i = 0; i < eventIds.length; i += VAR_CHUNK) {
    const slice = eventIds.slice(i, i + VAR_CHUNK);
    const placeholders = slice.map(() => '?').join(',');
    const res = await db.execute(
      `SELECT event_id FROM dm_messages WHERE owner = ? AND event_id IN (${placeholders});`,
      [owner, ...slice],
    );
    for (const r of res.rows ?? []) known.add(String(r.event_id));
  }
  return known;
}

/**
 * Upsert decrypted messages. Idempotent by (owner, event_id) (INSERT OR
 * REPLACE) and batched in one transaction so a large first-sync is a single
 * commit, not N.
 */
export async function upsertDmMessages(rows: readonly DmMessageRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getLocalDb();
  await db.transaction(async (tx) => {
    for (const m of rows) {
      await tx.execute(
        `INSERT OR REPLACE INTO dm_messages
           (owner, event_id, conversation, created_at, sender, content, from_me, wire_kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          m.owner,
          m.eventId,
          m.conversation,
          m.createdAt,
          m.sender,
          m.content,
          m.fromMe ? 1 : 0,
          m.wireKind,
        ],
      );
    }
  });
}

/**
 * One conversation's messages, newest-first, paginated. `beforeCreatedAt`
 * pages backwards (load-older). Uses the (owner, conversation, created_at)
 * index — O(result), no whole-table scan, no whole-blob parse.
 */
export async function getConversationMessages(
  owner: string,
  conversation: string,
  opts: { limit?: number; beforeCreatedAt?: number } = {},
): Promise<DmMessageRow[]> {
  const db = await getLocalDb();
  const limit = opts.limit ?? 50;
  const params: (string | number)[] = [owner, conversation];
  let sql = `SELECT * FROM dm_messages WHERE owner = ? AND conversation = ?`;
  if (opts.beforeCreatedAt != null) {
    sql += ` AND created_at < ?`;
    params.push(opts.beforeCreatedAt);
  }
  sql += ` ORDER BY created_at DESC LIMIT ?;`;
  params.push(limit);
  const res = await db.execute(sql, params);
  return (res.rows ?? []).map(toRow);
}

/**
 * The latest message in each of this owner's conversations, newest-first —
 * the inbox list. This is the read that replaces the whole-inbox blob parse:
 * the DB does the per-conversation MAX in one indexed query instead of JS
 * walking everything.
 */
export async function getInboxLatest(owner: string): Promise<DmMessageRow[]> {
  const db = await getLocalDb();
  const res = await db.execute(
    `SELECT m.* FROM dm_messages m
       JOIN (
         SELECT conversation, MAX(created_at) AS mx
         FROM dm_messages WHERE owner = ? GROUP BY conversation
       ) g ON m.conversation = g.conversation AND m.created_at = g.mx
     WHERE m.owner = ?
     ORDER BY m.created_at DESC;`,
    [owner, owner],
  );
  return (res.rows ?? []).map(toRow);
}

/**
 * All stored NIP-17 wrap ids for this owner (kind-4 rows excluded — their ids
 * are kind-4 event ids, not wrap ids). Seeds the live-DM sub's in-memory
 * dedup Set so a relay backlog re-stream short-circuits without re-decrypting
 * (#505/#848). Ids only — no plaintext leaves the DB here.
 */
export async function selectDmWrapIds(owner: string): Promise<string[]> {
  const db = await getLocalDb();
  const res = await db.execute(
    `SELECT event_id FROM dm_messages WHERE owner = ? AND wire_kind != 4;`,
    [owner],
  );
  return (res.rows ?? []).map((r) => String(r.event_id));
}

/**
 * Whether this owner has ANY stored NIP-17 rows — i.e. an inbox-wide wrap
 * ingest has run before. Thread opens use this to decide whether the
 * inbox-wide relay wrap fetch can be skipped (the DB already memoises every
 * decrypted wrap), mirroring the old "cache has any entries" fast path (#190).
 */
export async function hasStoredWraps(owner: string): Promise<boolean> {
  const db = await getLocalDb();
  const res = await db.execute(
    `SELECT 1 AS present FROM dm_messages WHERE owner = ? AND wire_kind != 4 LIMIT 1;`,
    [owner],
  );
  return (res.rows ?? []).length > 0;
}

/**
 * Delete every row belonging to `owner` — the per-account half of the logout
 * wipe (#848). When the LAST identity signs out, NostrContext additionally
 * calls `wipeLocalDmStore` (localDb) to delete the DB file + keystore key.
 */
export async function deleteDmMessagesForOwner(owner: string): Promise<void> {
  const db = await getLocalDb();
  await db.execute(`DELETE FROM dm_messages WHERE owner = ?;`, [owner]);
}
