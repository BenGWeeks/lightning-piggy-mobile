import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Group, GroupActivity } from '../types/groups';

// Account scoping: persisted under a single global key (`nostr_groups`)
// rather than namespaced per-account. Cross-account leak is prevented
// at logout by NostrContext.logout, which AsyncStorage.multiRemove's
// `nostr_groups` along with the per-pubkey caches. Per-account
// namespacing (`nostr_groups_${pubkey}`) becomes necessary when we add
// multi-account switching without a logout in between — tracked as a
// follow-up.
const GROUPS_KEY = 'nostr_groups';

export async function loadGroups(): Promise<Group[]> {
  try {
    const raw = await AsyncStorage.getItem(GROUPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Group[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveGroups(groups: Group[]): Promise<void> {
  await AsyncStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
}

export function createGroupId(): string {
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// Per-pubkey rollup of last-activity per group. Persisted so a cold app
// start can render the Messages tab's group rows with their last
// preview / timestamp immediately, instead of placeholder activity until
// each per-group `loadGroupMessages()` resolves. Mirrors the dmInbox
// eager-hydration pattern from PR #253. The cache is overwritten on
// every change to `activityByGroup`, so it stays roughly in sync with
// the in-memory state — stale by at most one app session.
const GROUP_ACTIVITY_KEY = (pubkey: string) => `nostr_group_activity_${pubkey}`;

/** Type-guard for a single GroupActivity entry. Rejects anything that
 * would crash downstream consumers — `formatConversationTimestamp`
 * throws `RangeError: Invalid time value` if `lastActivityAt` isn't a
 * finite number, so the cache must filter on shape, not just type. */
function isValidGroupActivity(v: unknown): v is GroupActivity {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.lastActivityAt === 'number' &&
    Number.isFinite(a.lastActivityAt) &&
    typeof a.lastText === 'string' &&
    (a.lastSenderPubkey === null || typeof a.lastSenderPubkey === 'string') &&
    Array.isArray(a.recentSenderPubkeys)
  );
}

export async function loadGroupActivity(pubkey: string): Promise<Record<string, GroupActivity>> {
  try {
    const raw = await AsyncStorage.getItem(GROUP_ACTIVITY_KEY(pubkey));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Reject arrays + non-plain values + entries that fail the shape check.
    // Stale / partial / older-schema caches are silently dropped rather
    // than crashing the Messages tab on next mount.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const valid: Record<string, GroupActivity> = {};
    for (const [groupId, entry] of Object.entries(parsed)) {
      if (isValidGroupActivity(entry)) valid[groupId] = entry;
    }
    return valid;
  } catch {
    return {};
  }
}

export async function saveGroupActivity(
  pubkey: string,
  activity: Record<string, GroupActivity>,
): Promise<void> {
  await AsyncStorage.setItem(GROUP_ACTIVITY_KEY(pubkey), JSON.stringify(activity));
}
