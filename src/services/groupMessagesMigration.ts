/**
 * One-way, no-loss migration of group-chat history from the legacy
 * device-wide `group_messages_<groupId>` blobs to per-account
 * `group_history_<owner>:<groupId>` keys (#1240).
 *
 * Why copy instead of re-key: a legacy blob can't be attributed to a single
 * account — two local accounts in the same group shared one blob — and Marmot
 * (MLS) history can't be re-fetched (forward secrecy). So each blob is COPIED
 * to every local account that is a member of the group, then deleted:
 *
 *  - owners = accounts whose saved group list (`nostr_groups_<pk>`) lists the
 *    group — for a synthetic NIP-17 room only if the room id re-derives from
 *    that list entry's members plus the account, so an entry leaked into
 *    another account's list by a pre-#1214 build isn't trusted — plus, for
 *    `marmot:` groups, accounts with state for it in the encrypted DB
 *    (`marmot_kv`, read-only). Activity rollups are NOT evidence (pre-#1214
 *    builds saved one account's rollup under another account's key);
 *  - copies MERGE into any existing per-account log (union by id, uncapped),
 *    so a re-run after a crash between "copy" and "delete" converges instead
 *    of duplicating, clobbering or truncating;
 *  - the legacy key is removed only after every copy is written;
 *  - a blob with no known owner is kept until the next sign-out decides it
 *    (`releaseLegacyGroupLogs`), never loaded;
 *  - a Marmot owner lookup failure (DB unavailable) defers that blob rather
 *    than guessing.
 *
 * The first pass also deletes, once, every `nostr_group_activity_*` rollup:
 * pre-#1214 builds leaked previews (another account's plaintext) into them,
 * and they are a cache that GroupsContext rebuilds from each account's own
 * history. Until that delete has succeeded `loadGroupActivity` reads empty.
 *
 * Runs once per app process, before any group history or rollup read (the
 * storage services await `ensureGroupMessagesMigrated()`), so nothing writes
 * those keys while it runs. Idempotent: with no legacy keys left and the
 * rollup flag set it is one `getAllKeys()` scan.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { GroupMessage } from './groupMessagesStorageService';
import {
  GROUP_HISTORY_KEY_PREFIX,
  groupMessagesKey,
  legacyGroupIdFromKey,
  legacyGroupMessagesKey,
  normaliseGroupOwner,
} from './groupMessagesKeys';
import { loadIdentities } from './identitiesStore';
import { listMarmotOwnersForGroup } from './marmotStore';
import { isSyntheticGroupId, syntheticGroupIdForParticipants } from '../utils/syntheticGroupId';

/** Set once every activity rollup has been deleted (one-time reset). */
export const GROUP_ACTIVITY_RESET_KEY = 'group_activity_rollups_reset_v1';

const MARMOT_PREFIX = 'marmot:';
const GROUP_LIST_KEY = /^nostr_groups_([0-9a-f]{64})$/;
const ACTIVITY_KEY = /^nostr_group_activity_[0-9a-f]{64}$/;
const ACCOUNT_DATA_KEY = new RegExp(
  `^(?:nostr_groups_|${GROUP_HISTORY_KEY_PREFIX})([0-9a-f]{64})(?::|$)`,
);

export interface GroupMessagesMigrationDeps {
  /** Owners with Marmot state for an MLS group (lowercase hex id). */
  marmotOwners: (mlsGroupIdHex: string) => Promise<string[]>;
  /** Pubkeys of the accounts registered on this device. */
  registeredAccounts: () => Promise<string[]>;
}

export interface GroupMessagesMigrationResult {
  /** groupId → owners it was copied to (legacy key then deleted). */
  migrated: Record<string, string[]>;
  /** Legacy blobs no local account owns (or that are unreadable). */
  unowned: string[];
  /** Legacy blobs kept because the Marmot owner lookup failed. */
  deferred: string[];
  /** Activity rollups deleted by the one-time reset. */
  resetActivity: number;
}

const defaultDeps: GroupMessagesMigrationDeps = {
  marmotOwners: listMarmotOwnersForGroup,
  registeredAccounts: async () => (await loadIdentities()).identities.map((i) => i.pubkey),
};

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

/**
 * Union by id (newer createdAt wins a collision), oldest first. Deliberately
 * NOT capped: the migration must never be the thing that drops a message —
 * the normal per-group cap applies on the next append, as it always has.
 */
export function mergeGroupLogs(a: GroupMessage[], b: GroupMessage[]): GroupMessage[] {
  const byId = new Map<string, GroupMessage>();
  for (const m of [...a, ...b]) {
    if (!m || typeof m.id !== 'string') continue;
    const prior = byId.get(m.id);
    if (!prior || prior.createdAt < m.createdAt) byId.set(m.id, m);
  }
  return Array.from(byId.values()).sort((x, y) => x.createdAt - y.createdAt);
}

/** Does this saved-list entry plausibly belong to `owner`'s own view? */
function isOwnListEntry(id: string, members: unknown, owner: string): boolean {
  if (!isSyntheticGroupId(id)) return true; // kind-30200: no roster to check against
  if (!Array.isArray(members)) return false;
  const pks = members.filter((m): m is string => typeof m === 'string');
  return syntheticGroupIdForParticipants([...pks, owner]) === id;
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
      const entry = g as { id?: unknown; memberPubkeys?: unknown } | null;
      const id = entry?.id;
      if (typeof id !== 'string' || !id) continue;
      if (!isOwnListEntry(id, entry?.memberPubkeys, owner)) continue;
      owners.set(id, (owners.get(id) ?? new Set<string>()).add(owner));
    }
  }
  return owners;
}

export async function runGroupMessagesMigration(
  overrides: Partial<GroupMessagesMigrationDeps> = {},
): Promise<GroupMessagesMigrationResult> {
  const deps = { ...defaultDeps, ...overrides };
  const result: GroupMessagesMigrationResult = {
    migrated: {},
    unowned: [],
    deferred: [],
    resetActivity: 0,
  };
  const keys = await AsyncStorage.getAllKeys();
  if (!keys.includes(GROUP_ACTIVITY_RESET_KEY)) {
    const rollups = keys.filter((k) => ACTIVITY_KEY.test(k));
    if (rollups.length > 0) await AsyncStorage.multiRemove(rollups);
    await AsyncStorage.setItem(GROUP_ACTIVITY_RESET_KEY, '1');
    result.resetActivity = rollups.length;
  }
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
      // Corrupt blob: nothing to copy; sign-out cleanup removes it.
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
      `[GroupHistory] ${result.unowned.length} unowned and ${result.deferred.length} deferred legacy group log(s) kept until the next sign-out (not shown)`,
    );
  }
  return result;
}

async function otherAccountsExist(
  leaving: string,
  deps: GroupMessagesMigrationDeps,
): Promise<boolean> {
  const registered = await deps.registeredAccounts().catch(() => [] as string[]);
  if (registered.some((pk) => normaliseGroupOwner(pk) !== leaving)) return true;
  // NIP-46 accounts aren't in the registry: any other account's group data counts.
  return (await AsyncStorage.getAllKeys()).some((k) => {
    const pk = ACCOUNT_DATA_KEY.exec(k)?.[1];
    return !!pk && pk !== leaving;
  });
}

/**
 * Sign-out cleanup for legacy blobs (#689 rule: decrypted content must not
 * outlive sign-out). Runs while the leaving account's group list and Marmot
 * state still exist: re-attributes every remaining legacy blob (copying it to
 * any account that now owns it — the leaving one's copy is deleted by the
 * caller), then deletes every blob no account can claim. A deferred blob
 * (Marmot DB unreadable) is kept only while another account remains that
 * might own it; with nobody left, everything goes.
 */
export async function releaseLegacyGroupLogs(
  leavingOwner: string,
  overrides: Partial<GroupMessagesMigrationDeps> = {},
): Promise<{ deleted: string[]; kept: string[] }> {
  const deps = { ...defaultDeps, ...overrides };
  const r = await runGroupMessagesMigration(deps);
  const deleted = [...r.unowned];
  const kept: string[] = [];
  if (r.deferred.length > 0) {
    if (await otherAccountsExist(leavingOwner, deps)) kept.push(...r.deferred);
    else deleted.push(...r.deferred);
  }
  if (deleted.length > 0) await AsyncStorage.multiRemove(deleted.map(legacyGroupMessagesKey));
  if (kept.length > 0) {
    console.warn(
      `[GroupHistory] kept ${kept.length} legacy group log(s) on sign-out: Marmot state unreadable, another account may own them`,
    );
  }
  return { deleted, kept };
}

let migration: Promise<void> | null = null;

/**
 * Resolves once the legacy migration has run in this process. Never rejects:
 * a failure leaves the legacy blobs in place (unshown) for a later run or the
 * next sign-out's cleanup rather than blocking group chats.
 */
export function ensureGroupMessagesMigrated(): Promise<void> {
  if (!migration) {
    migration = runGroupMessagesMigration().then(
      (r) => {
        const n = Object.keys(r.migrated).length;
        if (__DEV__ && (n > 0 || r.resetActivity > 0)) {
          console.log(
            `[GroupHistory] migrated ${n} group log(s) per account; reset ${r.resetActivity} activity rollup(s)`,
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
