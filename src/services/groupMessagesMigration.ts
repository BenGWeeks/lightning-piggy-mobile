/**
 * One-way, no-loss migration of group-chat history from the legacy
 * device-wide `group_messages_<groupId>` blobs to per-account
 * `group_messages_<owner>:<groupId>` keys (#1240).
 *
 * Why copy instead of re-key: a legacy blob can't be attributed to a single
 * account — two local accounts in the same group shared one blob — and Marmot
 * (MLS) history can't be re-fetched (forward secrecy). So each blob is COPIED
 * to every local account that owns the group, then deleted:
 *
 *  - owners = accounts whose saved group list (`nostr_groups_<pk>`) or
 *    activity rollup (`nostr_group_activity_<pk>`) lists the group, plus — for
 *    `marmot:` groups — accounts with state for it in the encrypted DB
 *    (`marmot_kv`, read-only);
 *  - copies MERGE into any existing per-account log (union by id), so a
 *    re-run after a crash between "copy" and "delete" converges instead of
 *    duplicating or clobbering;
 *  - the legacy key is removed only after every copy is written;
 *  - a blob with no known owner is KEPT on disk (never loaded, logged) — it is
 *    adopted on a later launch if an account picks the group up again;
 *  - a Marmot owner lookup failure (DB unavailable) defers that blob to the
 *    next launch rather than guessing.
 *
 * Runs once per app process, before any group read or write (the storage
 * service awaits `ensureGroupMessagesMigrated()`), so nothing writes the new
 * keys while it merges. Idempotent: with no legacy keys left it is one
 * `getAllKeys()` scan.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { GroupMessage } from './groupMessagesStorageService';
import { groupMessagesKey, legacyGroupIdFromKey, normaliseGroupOwner } from './groupMessagesKeys';
import { listMarmotOwnersForGroup } from './marmotStore';

/** Mirrors the per-group cap in groupMessagesStorageService. */
export const GROUP_MESSAGES_CAP = 500;

const MARMOT_PREFIX = 'marmot:';
const OWNER_LIST_KEY = /^(nostr_groups|nostr_group_activity)_([0-9a-f]{64})$/;

export interface GroupMessagesMigrationDeps {
  /** Owners with Marmot state for an MLS group (lowercase hex id). */
  marmotOwners: (mlsGroupIdHex: string) => Promise<string[]>;
}

export interface GroupMessagesMigrationResult {
  /** groupId → owners it was copied to (legacy key then deleted). */
  migrated: Record<string, string[]>;
  /** Legacy blobs kept because no local account owns the group. */
  unowned: string[];
  /** Legacy blobs kept for a retry next launch (owner lookup failed). */
  deferred: string[];
}

const defaultDeps: GroupMessagesMigrationDeps = { marmotOwners: listMarmotOwnersForGroup };

function parseLog(raw: string | null): GroupMessage[] | null {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as GroupMessage[]) : null;
  } catch {
    return null;
  }
}

/** Union by id (newer createdAt wins a collision), oldest first, capped. */
export function mergeGroupLogs(a: GroupMessage[], b: GroupMessage[]): GroupMessage[] {
  const byId = new Map<string, GroupMessage>();
  for (const m of [...a, ...b]) {
    if (!m || typeof m.id !== 'string') continue;
    const prior = byId.get(m.id);
    if (!prior || prior.createdAt < m.createdAt) byId.set(m.id, m);
  }
  const all = Array.from(byId.values()).sort((x, y) => x.createdAt - y.createdAt);
  return all.length <= GROUP_MESSAGES_CAP ? all : all.slice(all.length - GROUP_MESSAGES_CAP);
}

/** groupId → owners, from every account's saved group list + activity rollup. */
async function groupOwnersFromLists(keys: readonly string[]): Promise<Map<string, Set<string>>> {
  const owners = new Map<string, Set<string>>();
  const listKeys = keys.filter((k) => OWNER_LIST_KEY.test(k));
  if (listKeys.length === 0) return owners;
  const add = (groupId: unknown, owner: string) => {
    if (typeof groupId !== 'string' || !groupId) return;
    const set = owners.get(groupId) ?? new Set<string>();
    set.add(owner);
    owners.set(groupId, set);
  };
  for (const [key, raw] of await AsyncStorage.multiGet(listKeys)) {
    const owner = OWNER_LIST_KEY.exec(key)?.[2];
    if (!owner || !raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        for (const g of parsed) add((g as { id?: unknown } | null)?.id, owner);
      } else if (parsed && typeof parsed === 'object') {
        for (const groupId of Object.keys(parsed)) add(groupId, owner);
      }
    } catch {
      // A corrupt list attributes nothing; its groups stay unowned (kept).
    }
  }
  return owners;
}

export async function runGroupMessagesMigration(
  deps: GroupMessagesMigrationDeps = defaultDeps,
): Promise<GroupMessagesMigrationResult> {
  const result: GroupMessagesMigrationResult = { migrated: {}, unowned: [], deferred: [] };
  const keys = await AsyncStorage.getAllKeys();
  const legacy = keys.flatMap((key) => {
    const groupId = legacyGroupIdFromKey(key);
    return groupId ? [{ key, groupId }] : [];
  });
  if (legacy.length === 0) return result;

  const listOwners = await groupOwnersFromLists(keys);
  for (const { key, groupId } of legacy) {
    const owners = new Set(listOwners.get(groupId) ?? []);
    if (groupId.startsWith(MARMOT_PREFIX)) {
      try {
        const mlsId = groupId.slice(MARMOT_PREFIX.length).toLowerCase();
        for (const pk of await deps.marmotOwners(mlsId)) {
          const owner = normaliseGroupOwner(pk);
          if (owner) owners.add(owner);
        }
      } catch (e) {
        if (__DEV__) console.warn(`[GroupHistory] Marmot owner lookup failed for ${groupId}:`, e);
        result.deferred.push(groupId);
        continue;
      }
    }
    if (owners.size === 0) {
      result.unowned.push(groupId);
      continue;
    }
    const legacyLog = parseLog(await AsyncStorage.getItem(key));
    if (legacyLog === null) {
      // Corrupt blob: nothing to copy, and nothing we can safely delete.
      result.unowned.push(groupId);
      continue;
    }
    const copiedTo = [...owners].sort();
    for (const owner of copiedTo) {
      const target = groupMessagesKey(owner, groupId);
      const existing = parseLog(await AsyncStorage.getItem(target)) ?? [];
      await AsyncStorage.setItem(target, JSON.stringify(mergeGroupLogs(existing, legacyLog)));
    }
    // Every copy landed — only now is the legacy blob redundant.
    await AsyncStorage.removeItem(key);
    result.migrated[groupId] = copiedTo;
  }
  if (result.unowned.length > 0 || result.deferred.length > 0) {
    console.warn(
      `[GroupHistory] kept ${result.unowned.length} unowned and ${result.deferred.length} deferred legacy group log(s) on disk (not shown)`,
    );
  }
  return result;
}

let migration: Promise<void> | null = null;

/**
 * Resolves once the legacy migration has run in this process. Never rejects:
 * a failure leaves the legacy blobs in place for the next launch (and their
 * history unshown until then) rather than blocking group chats.
 */
export function ensureGroupMessagesMigrated(): Promise<void> {
  if (!migration) {
    migration = runGroupMessagesMigration().then(
      (r) => {
        const n = Object.keys(r.migrated).length;
        if (__DEV__ && n > 0) console.log(`[GroupHistory] migrated ${n} group log(s) per account`);
      },
      (e) => {
        console.warn('[GroupHistory] legacy migration failed; retrying next launch:', e);
      },
    );
  }
  return migration;
}

/** Test-only: forget that the migration ran in this process. */
export function resetGroupMessagesMigrationForTests(): void {
  migration = null;
}
