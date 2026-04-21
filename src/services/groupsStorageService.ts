import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Group } from '../types/groups';

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
