// User preference: render link-preview cards under DM messages?
//
// Default ON. Off means MessageLinkPreview renders nothing — the bare
// URL still appears in the bubble text and can be tapped to open in
// the browser.
//
// Privacy rationale: fetching OG metadata reveals to the URL's host
// that the URL was shared / opened (and leaks the device IP). Some
// users will prefer to keep that traffic off entirely; this toggle
// gives them the off-switch without compromising the feature for
// everyone else (#441).
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'link_preview_enabled_v1';

const DEFAULT_ENABLED = true;

let memoryValue: boolean | null = null;
const listeners = new Set<(enabled: boolean) => void>();

// Returns the current preference, hydrating from AsyncStorage on first
// call. Subsequent calls are sync-fast against the in-memory mirror.
export async function getLinkPreviewEnabled(): Promise<boolean> {
  if (memoryValue !== null) return memoryValue;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      memoryValue = DEFAULT_ENABLED;
    } else {
      memoryValue = raw === 'true';
    }
  } catch {
    memoryValue = DEFAULT_ENABLED;
  }
  return memoryValue;
}

// Persist the new value and notify subscribers (the in-bubble preview
// component subscribes so toggling on the Security screen reflects
// without a re-render of the whole conversation).
export async function setLinkPreviewEnabled(enabled: boolean): Promise<void> {
  memoryValue = enabled;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Persistence failure is non-fatal — the in-memory value still
    // serves the rest of the session.
  }
  for (const fn of listeners) fn(enabled);
}

export function subscribeLinkPreviewEnabled(fn: (enabled: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// Test-only: drop the in-memory mirror.
export function __resetForTests(): void {
  memoryValue = null;
  listeners.clear();
}
