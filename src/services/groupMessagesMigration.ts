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
 *  - owners = accounts whose saved group list (`nostr_groups_<pk>`) lists the
 *    group, plus — for `marmot:` groups — accounts with state for it in the
 *    encrypted DB (`marmot_kv`, read-only). Activity rollups are deliberately
 *    NOT evidence: pre-#1214 builds saved one account's rollup under another
 *    account's key, so trusting them would copy history across accounts;
 *  - copies MERGE into any existing per-account log (union by id), so a
 *    re-run after a crash between "copy" and "delete" converges instead of
 *    duplicating or clobbering;
 *  - the legacy key is removed only after every copy is written;
 *  - a blob with no known owner is KEPT on disk (never loaded, logged) — it is
 *    adopted on a later launch if an account picks the group up again;
 *  - a Marmot owner lookup failure (DB unavailable) defers that blob to the
 *    next launch rather than guessing.
 *
 * The same pass prunes, once, the activity rollup entries that leaked into
 * another account's `nostr_group_activity_<pk>` (their previews are the other
 * account's plaintext and would outlive its sign-out).
 *
 * Runs once per app process, before any group history or rollup read (the
 * storage services await `ensureGroupMessagesMigrated()`), so nothing writes
 * those keys while it runs. Idempotent: with no legacy keys left and the prune
 * flag set it is one `getAllKeys()` scan.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { GroupMessage } from './groupMessagesStorageService';
import { groupMessagesKey, legacyGroupIdFromKey, normaliseGroupOwner } from './groupMessagesKeys';
import { listMarmotOwnersForGroup } from './marmotStore';

/** Mirrors the per-group cap in groupMessagesStorageService. */
export const GROUP_MESSAGES_CAP = 500;

/** Set once the leaked activity-rollup entries have been pruned. */
export const GROUP_ACTIVITY_PRUNED_KEY = 'group_activity_owner_pruned_v1';

const MARMOT_PREFIX = 'marmot:';
const GROUP_LIST_KEY = /^nostr_groups_([0-9a-f]{64})$/;
const ACTIVITY_KEY = /^nostr_group_activity_([0-9a-f]{64})$/;

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
  /** Activity rollup entries removed from accounts that don't own the group. */
  prunedActivity: number;
}

const defaultDeps: GroupMessagesMigrationDeps = { marmotOwners: listMarmotOwnersForGroup };

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** A stored log, `[]` when absent, or null when unparseable. */
function parseLog(raw: string | null): GroupMessage[] | null {
  if (!raw) return [];
  const parsed = parseJson(raw);
  return Array.isArray(parsed) ? (parsed as GroupMessage[]) : null;
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

/** groupId → owners, from every account's saved group list. */
async function groupOwnersFromLists(keys: readonly string[]): Promise<Map<string, Set<string>>> {
  const owners = new Map<string, Set<string>>();
  const listKeys = keys.filter((k) => GROUP_LIST_KEY.test(k));
  if (listKeys.length === 0) return owners;
  for (const [key, raw] of await AsyncStorage.multiGet(listKeys)) {
    const owner = GROUP_LIST_KEY.exec(key)?.[1];
    const parsed = parseJson(raw);
    if (!owner || !Array.isArray(parsed)) continue; // corrupt list attributes nothing
    for (const g of parsed) {
      const id = (g as { id?: unknown } | null)?.id;
      if (typeof id !== 'string' || !id) continue;
      owners.set(id, (owners.get(id) ?? new Set<string>()).add(owner));
    }
  }
  return owners;
}

export async function runGroupMessagesMigration(
  deps: GroupMessagesMigrationDeps = defaultDeps,
): Promise<GroupMessagesMigrationResult> {
  const result: GroupMessagesMigrationResult = {
    migrated: {},
    unowned: [],
    deferred: [],
    prunedActivity: 0,
  };
  const keys = await AsyncStorage.getAllKeys();
  const legacy = keys.flatMap((key) => {
    const groupId = legacyGroupIdFromKey(key);
    return groupId ? [{ key, groupId }] : [];
  });
  const pruneActivity = !keys.includes(GROUP_ACTIVITY_PRUNED_KEY);
  if (legacy.length === 0 && !pruneActivity) return result;

  const listOwners = await groupOwnersFromLists(keys);
  const marmotCache = new Map<string, Promise<string[]>>();
  /** Owners of a group; throws when the Marmot lookup fails. */
  const ownersOf = async (groupId: string): Promise<Set<string>> => {
    const owners = new Set(listOwners.get(groupId) ?? []);
    if (groupId.startsWith(MARMOT_PREFIX)) {
      const mlsId = groupId.slice(MARMOT_PREFIX.length).toLowerCase();
      let lookup = marmotCache.get(mlsId);
      if (!lookup) {
        lookup = deps.marmotOwners(mlsId);
        marmotCache.set(mlsId, lookup);
      }
      for (const pk of await lookup) {
        const owner = normaliseGroupOwner(pk);
        if (owner) owners.add(owner);
      }
    }
    return owners;
  };

  for (const { key, groupId } of legacy) {
    let owners: Set<string>;
    try {
      owners = await ownersOf(groupId);
    } catch (e) {
      if (__DEV__) console.warn(`[GroupHistory] Marmot owner lookup failed for ${groupId}:`, e);
      result.deferred.push(groupId);
      continue;
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

  if (pruneActivity) {
    try {
      result.prunedActivity = await pruneForeignActivity(keys, ownersOf);
      await AsyncStorage.setItem(GROUP_ACTIVITY_PRUNED_KEY, '1');
    } catch (e) {
      // Leave the flag unset: the prune retries next launch.
      if (__DEV__) console.warn('[GroupHistory] activity prune failed:', e);
    }
  }

  if (result.unowned.length > 0 || result.deferred.length > 0) {
    console.warn(
      `[GroupHistory] kept ${result.unowned.length} unowned and ${result.deferred.length} deferred legacy group log(s) on disk (not shown)`,
    );
  }
  return result;
}

/**
 * Drop rollup entries for groups the rollup's account doesn't own. All owner
 * lookups run before anything is written, so a failure changes nothing.
 * Entries are a rebuildable cache: a wrongly dropped one only costs a
 * placeholder preview until the group's log is read again.
 */
async function pruneForeignActivity(
  keys: readonly string[],
  ownersOf: (groupId: string) => Promise<Set<string>>,
): Promise<number> {
  const activityKeys = keys.filter((k) => ACTIVITY_KEY.test(k));
  if (activityKeys.length === 0) return 0;
  const writes: [string, string][] = [];
  let pruned = 0;
  for (const [key, raw] of await AsyncStorage.multiGet(activityKeys)) {
    const owner = ACTIVITY_KEY.exec(key)?.[1];
    const parsed = parseJson(raw);
    if (!owner || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const kept: Record<string, unknown> = {};
    let dropped = 0;
    for (const [groupId, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if ((await ownersOf(groupId)).has(owner)) kept[groupId] = entry;
      else dropped += 1;
    }
    if (dropped > 0) {
      writes.push([key, JSON.stringify(kept)]);
      pruned += dropped;
    }
  }
  if (writes.length > 0) await AsyncStorage.multiSet(writes);
  return pruned;
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
        if (__DEV__ && (n > 0 || r.prunedActivity > 0)) {
          console.log(
            `[GroupHistory] migrated ${n} group log(s) per account; pruned ${r.prunedActivity} foreign activity entr(ies)`,
          );
        }
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
