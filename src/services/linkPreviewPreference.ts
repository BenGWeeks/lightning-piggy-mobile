// User preference: render link-preview cards under DM messages?
//
// Default ON. Off means MessageLinkPreview renders nothing — the bare
// URL still appears in the bubble text and can be tapped to open in
// the browser.
//
// Stored PER ACCOUNT (a shared family phone: one person's privacy choice
// must not apply to the others). Privacy rationale: fetching OG metadata
// reveals to the URL's host that the URL was shared / opened (and leaks the
// device IP). Some users will prefer to keep that traffic off entirely (#441).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { perAccountKey } from './perAccountStorage';
import { ensureSafetySettingsMigrated, LINK_PREVIEW_KEY_BASE } from './safetySettingsMigration';

const DEFAULT_ENABLED = true;

// In-memory mirror keyed by account so switching accounts never serves
// the previous account's value.
const memoryValues = new Map<string, boolean>();
const listeners = new Set<(pubkey: string, enabled: boolean) => void>();

// Returns the account's preference, hydrating from AsyncStorage on first
// call. Subsequent calls are sync-fast against the in-memory mirror.
export async function getLinkPreviewEnabled(pubkey: string | null): Promise<boolean> {
  if (!pubkey) return DEFAULT_ENABLED;
  const cached = memoryValues.get(pubkey);
  if (cached !== undefined) return cached;
  let value = DEFAULT_ENABLED;
  try {
    await ensureSafetySettingsMigrated(pubkey);
    const raw = await AsyncStorage.getItem(perAccountKey(LINK_PREVIEW_KEY_BASE, pubkey));
    if (raw !== null) value = raw === 'true';
  } catch {
    value = DEFAULT_ENABLED;
  }
  // A concurrent setter may have landed while we awaited; it wins.
  if (!memoryValues.has(pubkey)) memoryValues.set(pubkey, value);
  return memoryValues.get(pubkey) as boolean;
}

// Persist the new value and notify subscribers (the in-bubble preview
// component subscribes so toggling on the Security screen reflects
// without a re-render of the whole conversation).
export async function setLinkPreviewEnabled(
  enabled: boolean,
  pubkey: string | null,
): Promise<void> {
  if (!pubkey) return;
  memoryValues.set(pubkey, enabled);
  try {
    await ensureSafetySettingsMigrated(pubkey);
    await AsyncStorage.setItem(
      perAccountKey(LINK_PREVIEW_KEY_BASE, pubkey),
      enabled ? 'true' : 'false',
    );
  } catch {
    // Persistence failure is non-fatal — the in-memory value still
    // serves the rest of the session.
  }
  for (const fn of listeners) fn(pubkey, enabled);
}

export function subscribeLinkPreviewEnabled(
  fn: (pubkey: string, enabled: boolean) => void,
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// Drop one account's mirror (sign-out wipe) so a re-added account re-reads storage.
export function forgetLinkPreviewMirror(pubkey: string): void {
  memoryValues.delete(pubkey);
}

// Test-only: drop the in-memory mirror.
export function __resetForTests(): void {
  memoryValues.clear();
  listeners.clear();
}
