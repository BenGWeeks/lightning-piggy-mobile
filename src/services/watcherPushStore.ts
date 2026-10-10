// Per-account state for the notification watcher: which categories the user
// opted into, and what was last registered. A registration belongs to one
// Nostr key (the seal signer), so every account on the phone has its own.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { perAccountKey } from './perAccountStorage';
import { NO_CATEGORIES, WATCHER_CATEGORIES, type WatcherCategories } from './watcherRegistration';

export const WATCHER_PUSH_KEY_BASE = 'watcher_push_v1';

export interface RegisteredRecord {
  /** registrationFingerprint() of what the watcher holds. */
  fingerprint: string;
  /** The same, ignoring relays — tells a relay-only change apart. */
  coreFingerprint: string;
  /** pushTokenHash() of the device token it was registered for (never the
   * raw token — that is re-read from the OS). */
  tokenHash: string;
  platform: 'apns' | 'fcm';
  app: string;
  /** When it was sent (ms) — drives the 7-day refresh. */
  at: number;
}

export interface WatcherAccountState {
  categories: WatcherCategories;
  /** The last `ts` sent (unix s). The watcher needs it to strictly increase
   * per user, so it is written BEFORE each publish. */
  lastTs: number;
  /** What the watcher holds for this phone, or null for nothing. */
  registered: RegisteredRecord | null;
}

export const EMPTY_STATE: WatcherAccountState = {
  categories: NO_CATEGORIES,
  lastTs: 0,
  registered: null,
};

const keyFor = (pubkey: string) => perAccountKey(WATCHER_PUSH_KEY_BASE, pubkey);

function sanitise(raw: unknown): WatcherAccountState {
  if (!raw || typeof raw !== 'object') return EMPTY_STATE;
  const r = raw as Partial<WatcherAccountState>;
  const categories = { ...NO_CATEGORIES };
  for (const k of WATCHER_CATEGORIES) categories[k] = r.categories?.[k] === true;
  const reg = r.registered;
  const registered =
    reg &&
    typeof reg.fingerprint === 'string' &&
    typeof reg.coreFingerprint === 'string' &&
    typeof reg.tokenHash === 'string' &&
    (reg.platform === 'apns' || reg.platform === 'fcm') &&
    typeof reg.app === 'string' &&
    typeof reg.at === 'number'
      ? reg
      : null;
  return {
    categories,
    lastTs: typeof r.lastTs === 'number' && Number.isFinite(r.lastTs) ? r.lastTs : 0,
    registered,
  };
}

/** Throws when storage can't be read — an unreadable state must never be
 * taken for "nothing registered" (lastTs would go backwards). */
export async function loadWatcherState(pubkey: string): Promise<WatcherAccountState> {
  const raw = await AsyncStorage.getItem(keyFor(pubkey));
  if (!raw) return EMPTY_STATE;
  try {
    return sanitise(JSON.parse(raw));
  } catch {
    return EMPTY_STATE;
  }
}

export async function saveWatcherState(pubkey: string, state: WatcherAccountState): Promise<void> {
  await AsyncStorage.setItem(keyFor(pubkey), JSON.stringify(state));
}
