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

// One-shot action params that make a screen DO something on mount — e.g.
// HomeScreen opens the Send sheet whenever `sendToAddress` is present (set
// by a Friends-tab zap). If these survive a cold start they replay every
// launch: a stale invoice keeps re-opening the Send sheet pre-filled to pay
// (#886). Stripped from every route before the state is persisted/restored.
const TRANSIENT_PARAM_KEYS = [
  'sendToAddress',
  'sendToPicture',
  'sendToPubkey',
  'sendToName',
  'openComposer',
];

// One-shot destination routes reached via a deep link / NFC tap / share — a
// geo-cache (Piglet) detail page or an LNURL-withdraw claim flow. Restoring
// straight back into one on launch replays a stale action (the app reopens
// the last cache every time). Popped on restore so we land on the parent
// stack (ExploreHome / Hunt) instead of the transient leaf.
const TRANSIENT_ROUTE_NAMES = ['HuntPiggyDetail', 'HuntFound'];

// Structural view of a NavigationState used by the sanitizer — React
// Navigation's own type is deeply generic; we only touch these fields.
interface NavStateLike {
  index?: number;
  routes: { name: string; params?: unknown; state?: NavStateLike }[];
  [key: string]: unknown;
}

const stripTransientParams = (params: unknown): unknown => {
  if (!params || typeof params !== 'object') return params;
  const next = { ...(params as Record<string, unknown>) };
  let changed = false;
  for (const key of TRANSIENT_PARAM_KEYS) {
    if (key in next) {
      delete next[key];
      changed = true;
    }
  }
  if (!changed) return params;
  return Object.keys(next).length > 0 ? next : undefined;
};

// Recursively remove one-shot params and pop transient deep-link routes so a
// restored cold-start never replays a stale action. Pure + total: returns the
// input unchanged when there's nothing to clean, and never produces an empty
// `routes` array (which would throw at NavigationContainer mount).
export const sanitizeNavigationState = (
  state: NavigationState | undefined,
): NavigationState | undefined => {
  if (!state || !Array.isArray((state as unknown as NavStateLike).routes)) return state;
  const s = state as unknown as NavStateLike;
  const cleanedRoutes = s.routes.map((route) => ({
    ...route,
    params: stripTransientParams(route.params),
    state: route.state
      ? (sanitizeNavigationState(route.state as unknown as NavigationState) as
          | NavStateLike
          | undefined)
      : route.state,
  }));
  const kept = cleanedRoutes.filter((route) => !TRANSIENT_ROUTE_NAMES.includes(route.name));
  // Never hand back an empty stack — if every route was transient, keep the
  // cleaned (param-stripped) routes rather than crash the navigator.
  const routes = kept.length > 0 ? kept : cleanedRoutes;
  const index = Math.min(
    typeof s.index === 'number' ? s.index : routes.length - 1,
    routes.length - 1,
  );
  return { ...s, routes, index } as unknown as NavigationState;
};

// Minimal NavigationState shape check — enough to keep us from handing
// NavigationContainer a malformed blob that crashes on mount. We don't
// recurse into nested route state; React Navigation rebuilds nested
// state lazily as the user navigates, so a missing nested field
// degrades to "restore the parent stack, lose the child" rather than
// throwing. An empty `{}` or an array of routes-without-names would
// throw at mount, hence the explicit array / `name`-string check.
const isNavigationStateShape = (v: unknown): v is NavigationState => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const s = v as Record<string, unknown>;
  if (typeof s.index !== 'number') return false;
  if (!Array.isArray(s.routes)) return false;
  if (!Array.isArray(s.routeNames)) return false;
  if (
    !s.routes.every(
      (r) => r && typeof r === 'object' && typeof (r as { name?: unknown }).name === 'string',
    )
  ) {
    return false;
  }
  return true;
};

const isPersistedNavState = (v: unknown): v is PersistedNavState => {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.version === 'number' &&
    typeof o.savedAt === 'number' &&
    isNavigationStateShape(o.state)
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
    // Sanitize on READ as well as write: devices that persisted a stale
    // action (a pre-filled Send invoice, a deep-linked cache page) BEFORE
    // this fix shipped self-heal on the next launch instead of replaying it.
    return sanitizeNavigationState(parsed.state);
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
    const clean = sanitizeNavigationState(state);
    if (!clean) return;
    const payload: PersistedNavState = {
      version: SCHEMA_VERSION,
      state: clean,
      savedAt: Date.now(),
    };
    await AsyncStorage.setItem(NAV_STATE_KEY, JSON.stringify(payload));
  } catch {
    // Swallow.
  }
};

// Clear the persisted state. Exposed for tests / debug; intended for
// future sign-out / identity-switch wiring so the next signed-in
// session doesn't restore the previous user's last screen. Not yet
// called from the auth flow — see #598 follow-up.
export const clearPersistedNavigationState = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(NAV_STATE_KEY);
  } catch {
    // Swallow.
  }
};
