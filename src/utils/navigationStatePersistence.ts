// AsyncStorage-backed persistence for the React Navigation root state.
// Without this, every cold-start (OS killed the app while backgrounded,
// device reboot, GrapheneOS being aggressive) drops the user back on
// the Home tab regardless of where they were. See #598.
//
// The key is versioned: bumping `SCHEMA_VERSION` invalidates every
// previously-persisted state in one stroke, which is what we want when
// a screen is renamed / removed and the saved route would otherwise
// fail to mount.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NavigationState } from '@react-navigation/native';

const SCHEMA_VERSION = 1;
export const NAV_STATE_KEY = `@lp/nav-state/v${SCHEMA_VERSION}`;

interface PersistedNavState {
  version: number;
  state: NavigationState;
  savedAt: number;
}

const isPersistedNavState = (v: unknown): v is PersistedNavState => {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.version === 'number' &&
    typeof o.savedAt === 'number' &&
    typeof o.state === 'object' &&
    o.state !== null
  );
};

// Returns the persisted navigation state, or `undefined` if nothing's
// saved / the saved blob is from a previous schema / storage failed.
// Never throws — callers can blindly pass the result to NavigationContainer's
// `initialState`, where `undefined` falls through to navigator defaults.
export const loadPersistedNavigationState = async (): Promise<NavigationState | undefined> => {
  try {
    const raw = await AsyncStorage.getItem(NAV_STATE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedNavState(parsed)) return undefined;
    if (parsed.version !== SCHEMA_VERSION) return undefined;
    return parsed.state;
  } catch {
    // Corrupt JSON, AsyncStorage unavailable, schema mismatch — treat
    // as "no saved state" and let the navigator render defaults.
    return undefined;
  }
};

// Save the current navigation state. Fire-and-forget — failures are
// swallowed because losing a single save is no worse than the pre-#598
// behaviour (no persistence at all).
export const persistNavigationState = async (state: NavigationState | undefined): Promise<void> => {
  if (!state) return;
  try {
    const payload: PersistedNavState = { version: SCHEMA_VERSION, state, savedAt: Date.now() };
    await AsyncStorage.setItem(NAV_STATE_KEY, JSON.stringify(payload));
  } catch {
    // Swallow.
  }
};

// Clear the persisted state. Used on sign-out so the next signed-in
// session doesn't restore the previous user's last screen, and exposed
// for tests / debug.
export const clearPersistedNavigationState = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(NAV_STATE_KEY);
  } catch {
    // Swallow.
  }
};
