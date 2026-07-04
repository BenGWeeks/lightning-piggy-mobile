import type { DeliveryStatus } from '../utils/dmDeliveryStatus';
import { getLocalDb } from './localDb';

// Data-access layer for the `dm_messages` table in the encrypted local DB
// (#695). One row per decrypted DM, keyed by (owner, event_id) — `owner` is
// the signed-in account's pubkey, so multi-account devices keep each
// identity's rows separate (#848). Replaces the single-blob wrap cache whose
// whole-blob parse + re-decrypt froze the Messages tab for ~52s (see
// docs/DATA_STORAGE.adoc). All reads are indexed slice reads — never "load
// the whole inbox into JS".
//
// #850: this store is now the ONLY at-rest home for decrypted DM content.
// The plaintext AsyncStorage blobs (`nostr_dm_conv_v1_*` /
// `nostr_dm_inbox_v1_*`) are retired; what only they used to carry —
// deliveryStatus (#856), rumorId (#857) and the optimistic `local-` send
// rows — lives in the delivery_status / rumor_id columns and in rows whose
// event_id starts with LOCAL_DM_ID_PREFIX.

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
  /** Per-relay delivery breakdown for our own sent rows (#856). Persisted so
   * the tick survives a cold restart without any plaintext side blob. */
  deliveryStatus?: DeliveryStatus;
  /** NIP-17 inner-rumor event id (#857) — the delivery-store key, stable
   * across the optimistic local- row and the relay echo. Sent rows only. */
  rumorId?: string;
}

/** Prefix of the optimistic send rows ConversationScreen appends before the
 * relay echo lands. Kept as first-class rows (#850) so a send survives a cold
 * restart; `upsertDmMessages` retires them when their echo arrives. */
export const LOCAL_DM_ID_PREFIX = 'local-';

/** Window in seconds to match a real-id echo against a pending optimistic
 * local- row (same fromMe + same text). Single source of truth for both the
 * in-memory merge (nostrDmCache) and the store-level echo retire below. */
export const LOCAL_DM_ECHO_WINDOW_SECS = 30;

// SQLite caps bound variables per statement (historically 999). Chunk IN()
// lists well under that.
const VAR_CHUNK = 500;

const parseDeliveryStatus = (raw: unknown): DeliveryStatus | undefined => {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as DeliveryStatus;
    }
  } catch {
    // Corrupt JSON → treat as no status (tick simply doesn't render).
  }
  return undefined;
};

const serializeDeliveryStatus = (s: DeliveryStatus | undefined): string | null => {
  if (!s) return null;
  try {
    return JSON.stringify(s);
  } catch {
    return null;
  }
};

const toRow = (r: Record<string, unknown>): DmMessageRow => {
  const deliveryStatus = parseDeliveryStatus(r.delivery_status);
  const rumorId = typeof r.rumor_id === 'string' && r.rumor_id.length > 0 ? r.rumor_id : undefined;
  return {
    owner: String(r.owner),
    eventId: String(r.event_id),
    conversation: String(r.conversation),
    createdAt: Number(r.created_at),
    sender: String(r.sender),
    content: String(r.content),
    fromMe: Number(r.from_me) === 1,
    wireKind: Number(r.wire_kind),
    ...(deliveryStatus !== undefined ? { deliveryStatus } : {}),
    ...(rumorId !== undefined ? { rumorId } : {}),
  };
};

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

// Minimal shape shared by the DB handle and a transaction context — both
// expose `execute`, which is all the upsert body needs.
type Executor = {
  execute: (
    sql: string,
    params?: (string | number | null)[],
  ) => Promise<{
    rows?: Record<string, unknown>[];
  }>;
};

async function upsertOne(tx: Executor, m: DmMessageRow): Promise<void> {
  let deliveryStatus = m.deliveryStatus;
  let rumorId = m.rumorId;
  // Echo retire (#850, mirrors mergeConversationMessages): a real-id row we
  // authored replaces its pending optimistic local- row — inherit the local-
  // row's delivery tick (#856) + rumorId (#857) when the echo lacks its own,
  // then delete the local- row so the store never shows two bubbles for one
  // send. Only sent rows can match (local- rows are always fromMe).
  if (m.fromMe && !m.eventId.startsWith(LOCAL_DM_ID_PREFIX)) {
    const res = await tx.execute(
      `SELECT event_id, delivery_status, rumor_id, created_at FROM dm_messages
        WHERE owner = ? AND conversation = ? AND from_me = 1 AND content = ?
          AND event_id LIKE '${LOCAL_DM_ID_PREFIX}%'
          AND ABS(created_at - ?) <= ${LOCAL_DM_ECHO_WINDOW_SECS};`,
      [m.owner, m.conversation, m.content, m.createdAt],
    );
    const candidates = res.rows ?? [];
    if (candidates.length > 0) {
      // Closest-in-time match wins, mirroring the in-memory merge.
      const best = candidates.reduce((a, b) =>
        Math.abs(Number(a.created_at) - m.createdAt) <= Math.abs(Number(b.created_at) - m.createdAt)
          ? a
          : b,
      );
      deliveryStatus = deliveryStatus ?? parseDeliveryStatus(best.delivery_status);
      rumorId =
        rumorId ??
        (typeof best.rumor_id === 'string' && best.rumor_id.length > 0 ? best.rumor_id : undefined);
      await tx.execute(`DELETE FROM dm_messages WHERE owner = ? AND event_id = ?;`, [
        m.owner,
        String(best.event_id),
      ]);
    }
  }
  // COALESCE keeps an existing tick/rumorId when a later re-ingest of the
  // same event id supplies neither (#856/#857: a warm relay re-decrypt of an
  // already-ticked echo must not strip the tick).
  await tx.execute(
    `INSERT INTO dm_messages
       (owner, event_id, conversation, created_at, sender, content, from_me, wire_kind,
        delivery_status, rumor_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner, event_id) DO UPDATE SET
       conversation    = excluded.conversation,
       created_at      = excluded.created_at,
       sender          = excluded.sender,
       content         = excluded.content,
       from_me         = excluded.from_me,
       wire_kind       = excluded.wire_kind,
       delivery_status = COALESCE(excluded.delivery_status, dm_messages.delivery_status),
       rumor_id        = COALESCE(excluded.rumor_id, dm_messages.rumor_id);`,
    [
      m.owner,
      m.eventId,
      m.conversation,
      m.createdAt,
      m.sender,
      m.content,
      m.fromMe ? 1 : 0,
      m.wireKind,
      serializeDeliveryStatus(deliveryStatus),
      rumorId ?? null,
    ],
  );
}

/**
 * Upsert decrypted messages. Idempotent by (owner, event_id) and batched in
 * one transaction so a large first-sync is a single commit, not N. Retires
 * matched optimistic local- rows (see `upsertOne`) and never downgrades an
 * existing delivery tick / rumorId to NULL.
 */
export async function upsertDmMessages(rows: readonly DmMessageRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getLocalDb();
  await db.transaction(async (tx) => {
    for (const m of rows) await upsertOne(tx as Executor, m);
  });
}

/**
 * Import rows without clobbering anything already stored (#850 blob
 * migration): an existing row's content/metadata always wins; the import only
 * fills a missing delivery_status / rumor_id (the two fields the retired
 * plaintext conversation blobs were the sole carrier of). New ids insert
 * whole. One transaction.
 */
export async function importDmMessages(rows: readonly DmMessageRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getLocalDb();
  await db.transaction(async (tx) => {
    for (const m of rows) {
      await tx.execute(
        `INSERT INTO dm_messages
           (owner, event_id, conversation, created_at, sender, content, from_me, wire_kind,
            delivery_status, rumor_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner, event_id) DO UPDATE SET
           delivery_status = COALESCE(dm_messages.delivery_status, excluded.delivery_status),
           rumor_id        = COALESCE(dm_messages.rumor_id, excluded.rumor_id);`,
        [
          m.owner,
          m.eventId,
          m.conversation,
          m.createdAt,
          m.sender,
          m.content,
          m.fromMe ? 1 : 0,
          m.wireKind,
          serializeDeliveryStatus(m.deliveryStatus),
          m.rumorId ?? null,
        ],
      );
    }
  });
}

/**
 * Attach delivery statuses (#856) to stored rows by event id, filling only
 * rows that don't already carry one — mirrors the old persisted-blob rule
 * ("only write when it adds a tick") so a settled breakdown is never
 * overwritten by a later, thinner snapshot.
 */
export async function updateDmDeliveryStatuses(
  owner: string,
  statusById: Record<string, DeliveryStatus>,
): Promise<void> {
  const entries = Object.entries(statusById);
  if (entries.length === 0) return;
  const db = await getLocalDb();
  await db.transaction(async (tx) => {
    for (const [eventId, status] of entries) {
      const serialized = serializeDeliveryStatus(status);
      if (!serialized) continue;
      await tx.execute(
        `UPDATE dm_messages SET delivery_status = ?
          WHERE owner = ? AND event_id = ? AND delivery_status IS NULL;`,
        [serialized, owner, eventId],
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
 * Whether this owner has ANY stored message for `conversation` — the
 * live-sub's "is this marketplace partner already a conversation?" trust
 * check (#850; replaces scanning the retired plaintext inbox blob).
 */
export async function hasConversationWith(owner: string, conversation: string): Promise<boolean> {
  const db = await getLocalDb();
  const res = await db.execute(
    `SELECT 1 AS present FROM dm_messages WHERE owner = ? AND conversation = ? LIMIT 1;`,
    [owner, conversation],
  );
  return (res.rows ?? []).length > 0;
}

/**
 * All stored NIP-17 wrap ids for this owner (kind-4 rows excluded — their ids
 * are kind-4 event ids, not wrap ids; optimistic local- rows excluded — their
 * ids are synthetic, never relay-delivered). Seeds the live-DM sub's
 * in-memory dedup Set so a relay backlog re-stream short-circuits without
 * re-decrypting (#505/#848). Ids only — no plaintext leaves the DB here.
 */
export async function selectDmWrapIds(owner: string): Promise<string[]> {
  const db = await getLocalDb();
  const res = await db.execute(
    `SELECT event_id FROM dm_messages
      WHERE owner = ? AND wire_kind != 4 AND event_id NOT LIKE '${LOCAL_DM_ID_PREFIX}%';`,
    [owner],
  );
  return (res.rows ?? []).map((r) => String(r.event_id));
}

/**
 * Whether this owner has ANY stored NIP-17 rows — i.e. an inbox-wide wrap
 * ingest has run before. Thread opens use this to decide whether the
 * inbox-wide relay wrap fetch can be skipped (the DB already memoises every
 * decrypted wrap), mirroring the old "cache has any entries" fast path (#190).
 * Optimistic local- rows don't count — a first-ever send must not fake a
 * completed ingest (#850).
 */
export async function hasStoredWraps(owner: string): Promise<boolean> {
  const db = await getLocalDb();
  const res = await db.execute(
    `SELECT 1 AS present FROM dm_messages
      WHERE owner = ? AND wire_kind != 4 AND event_id NOT LIKE '${LOCAL_DM_ID_PREFIX}%' LIMIT 1;`,
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
