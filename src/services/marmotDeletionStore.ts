import { getLocalDb } from './localDb';
import type { MarmotDeletion } from './marmotDeletions';

// Durable "delete for everyone" tombstones, in the encrypted local DB's
// `marmot_deletions` table (localDb.ts). One row per (owner, group, target,
// deleter): the session ledger is only a bounded cache, and this is what stops
// a deleted message reappearing when the group history replays at next start.
// No message bodies — just ids and pubkeys.
//
// Any group member can send a kind 5 naming thousands of made-up ids, so the
// table is capped: per deleter within a group (an attacker can only ever
// evict their OWN tombstones), per group, and per account. Rows go with the
// account at sign-out and with the group when we leave it.

/** Tombstones one deleter may hold in one group (oldest evicted first). */
export const TOMBSTONES_PER_DELETER = 1000;
/** Tombstones one group may hold. */
export const TOMBSTONES_PER_GROUP = 5000;
/** Tombstones one account may hold across all its groups. */
export const TOMBSTONES_PER_OWNER = 20000;

const VAR_CHUNK = 500;
// 5 bound values per row: 100 rows stays inside the 500-variable chunk.
const INSERT_CHUNK = 100;

/** A message a tombstone may hide: its group (scope), event id and author. */
export interface MarmotMessageKey {
  scope: string;
  id: string;
  sender: string;
}

/** Stable map key for one message in one group. */
export const marmotMessageKey = (scope: string, id: string) => `${scope}\n${id.toLowerCase()}`;

/** Persist deletions for `owner`. Re-recording one is a no-op, except that admin
 * authority, once recorded, sticks. */
export async function rememberMarmotDeletions(
  owner: string,
  entries: readonly { scope: string; deletion: MarmotDeletion }[],
): Promise<void> {
  const rows = new Map<string, [string, string, string, number]>();
  for (const { scope, deletion } of entries) {
    const deleter = deletion.deleter.toLowerCase();
    for (const target of deletion.targets) {
      const id = target.toLowerCase();
      const k = `${scope}\n${id}\n${deleter}`;
      const anyAuthor = deletion.anyAuthor ? 1 : (rows.get(k)?.[3] ?? 0);
      rows.set(k, [scope, id, deleter, anyAuthor]);
    }
  }
  if (rows.size === 0) return;
  const db = await getLocalDb();
  const touched = new Map<string, [string, string]>();
  for (const [scope, , deleter] of rows.values())
    touched.set(`${scope}\n${deleter}`, [scope, deleter]);
  const all = [...rows.values()];
  await db.transaction(async (tx) => {
    // Multi-row inserts: a kind 5 may name ~2,000 ids — 20 statements, not 2,000.
    for (let i = 0; i < all.length; i += INSERT_CHUNK) {
      const slice = all.slice(i, i + INSERT_CHUNK);
      await tx.execute(
        `INSERT INTO marmot_deletions (owner, scope, target, deleter, any_author)
           VALUES ${slice.map(() => '(?, ?, ?, ?, ?)').join(', ')}
           ON CONFLICT (owner, scope, target, deleter)
           DO UPDATE SET any_author = MAX(any_author, excluded.any_author);`,
        slice.flatMap((r) => [owner, ...r]),
      );
    }
    // Evict beyond the caps, oldest (lowest rowid) first.
    for (const [scope, deleter] of touched.values()) {
      await tx.execute(
        `DELETE FROM marmot_deletions WHERE rowid IN (
           SELECT rowid FROM marmot_deletions WHERE owner = ? AND scope = ? AND deleter = ?
           ORDER BY rowid DESC LIMIT -1 OFFSET ?);`,
        [owner, scope, deleter, TOMBSTONES_PER_DELETER],
      );
    }
    for (const scope of new Set([...touched.values()].map(([s]) => s))) {
      await tx.execute(
        `DELETE FROM marmot_deletions WHERE rowid IN (
           SELECT rowid FROM marmot_deletions WHERE owner = ? AND scope = ?
           ORDER BY rowid DESC LIMIT -1 OFFSET ?);`,
        [owner, scope, TOMBSTONES_PER_GROUP],
      );
    }
    await tx.execute(
      `DELETE FROM marmot_deletions WHERE rowid IN (
         SELECT rowid FROM marmot_deletions WHERE owner = ?
         ORDER BY rowid DESC LIMIT -1 OFFSET ?);`,
      [owner, TOMBSTONES_PER_OWNER],
    );
  });
}

/**
 * Which of `messages` a tombstone hides, as `marmotMessageKey`s — one indexed
 * query per 500 ids, so a whole flush is checked at once. A tombstone hides a
 * message when it's an admin removal, or its deleter is the message's author.
 */
export async function deletedMarmotMessages(
  owner: string,
  messages: readonly MarmotMessageKey[],
): Promise<Set<string>> {
  const deleted = new Set<string>();
  if (messages.length === 0) return deleted;
  const senders = new Map<string, string>();
  for (const m of messages) senders.set(marmotMessageKey(m.scope, m.id), m.sender.toLowerCase());
  const ids = [...new Set(messages.map((m) => m.id.toLowerCase()))];
  const db = await getLocalDb();
  for (let i = 0; i < ids.length; i += VAR_CHUNK) {
    const slice = ids.slice(i, i + VAR_CHUNK);
    const res = await db.execute(
      `SELECT scope, target, deleter, any_author FROM marmot_deletions
         WHERE owner = ? AND target IN (${slice.map(() => '?').join(',')});`,
      [owner, ...slice],
    );
    for (const row of res.rows ?? []) {
      const k = marmotMessageKey(String(row.scope), String(row.target));
      const sender = senders.get(k);
      if (sender !== undefined && (Number(row.any_author) === 1 || row.deleter === sender)) {
        deleted.add(k);
      }
    }
  }
  return deleted;
}

export async function isMarmotDeleted(
  owner: string,
  scope: string,
  id: string,
  sender: string,
): Promise<boolean> {
  return (await deletedMarmotMessages(owner, [{ scope, id, sender }])).size > 0;
}

/** Drop one group's tombstones (we left it, or were removed). */
export async function forgetMarmotDeletionsForGroup(owner: string, scope: string): Promise<void> {
  const db = await getLocalDb();
  await db.execute('DELETE FROM marmot_deletions WHERE owner = ? AND scope = ?;', [owner, scope]);
}

/** Drop every tombstone `owner` holds (per-account sign-out). */
export async function forgetMarmotDeletionsForOwner(owner: string): Promise<void> {
  const db = await getLocalDb();
  await db.execute('DELETE FROM marmot_deletions WHERE owner = ?;', [owner]);
}
