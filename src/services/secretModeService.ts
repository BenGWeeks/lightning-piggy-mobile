// Secret Mode flag, stored PER ACCOUNT: unlocking the wider trust tiers and
// "Import Seed Phrase (Beta)" for one family member must not unlock them for
// everyone else on the same phone. Off by default for every new account.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { perAccountKey } from './perAccountStorage';
import { ensureSafetySettingsMigrated, SECRET_MODE_KEY_BASE } from './safetySettingsMigration';

export const SECRET_MODE_STORAGE_KEY_BASE = SECRET_MODE_KEY_BASE;

export async function loadSecretMode(pubkey: string | null): Promise<boolean> {
  if (!pubkey) return false;
  try {
    await ensureSafetySettingsMigrated(pubkey);
    return (await AsyncStorage.getItem(perAccountKey(SECRET_MODE_KEY_BASE, pubkey))) === 'true';
  } catch {
    return false;
  }
}

export async function saveSecretMode(enabled: boolean, pubkey: string | null): Promise<void> {
  if (!pubkey) return;
  try {
    await ensureSafetySettingsMigrated(pubkey);
    await AsyncStorage.setItem(
      perAccountKey(SECRET_MODE_KEY_BASE, pubkey),
      enabled ? 'true' : 'false',
    );
  } catch {
    // Best-effort; in-memory state still drives the session.
  }
}
