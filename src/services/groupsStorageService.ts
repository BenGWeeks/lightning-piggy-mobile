import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Group } from '../types/groups';

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
