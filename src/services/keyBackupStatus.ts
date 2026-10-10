// Per-account "the user has backed up this key" flag.
//
// Set from the Back up your key screen when the user confirms they've
// saved their nsec somewhere safe; read by the sign-out confirmation to
// pick a lighter warning. Stored in AsyncStorage (it's a boolean, not
// secret material) under a per-account key, and wiped with the rest of
// the account's caches on sign-out (see accountCacheWipe.ts).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { perAccountKey } from './perAccountStorage';

export const KEY_BACKED_UP_KEY_BASE = 'nostr_key_backed_up';

export function keyBackedUpKey(pubkey: string): string {
  return perAccountKey(KEY_BACKED_UP_KEY_BASE, pubkey);
}

export async function isKeyBackedUp(pubkey: string | null | undefined): Promise<boolean> {
  if (!pubkey) return false;
  try {
    return (await AsyncStorage.getItem(keyBackedUpKey(pubkey))) === '1';
  } catch {
    // Unreadable -> treat as not backed up, so the stronger warning shows.
    return false;
  }
}

export async function markKeyBackedUp(pubkey: string): Promise<void> {
  await AsyncStorage.setItem(keyBackedUpKey(pubkey), '1');
}

export async function clearKeyBackedUp(pubkey: string): Promise<void> {
  await AsyncStorage.removeItem(keyBackedUpKey(pubkey));
}
