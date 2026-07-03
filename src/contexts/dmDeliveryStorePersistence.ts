import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DeliveryStatus } from '../utils/dmDeliveryStatus';
import {
  hydrateDmDeliveryStore,
  setDmDeliveryPersist,
  getPersistableDmDeliveryStatuses,
} from '../utils/dmDeliveryStore';

// AsyncStorage key for the per-user eventId-keyed delivery store (#857). One
// JSON blob per account; small (a few dozen recent sends), pruned implicitly by
// the conv-cache cap since stale eventIds simply never re-render.
const DM_DELIVERY_STORE_PREFIX = 'dmDeliveryStore_';

export function dmDeliveryStoreKey(user: string): string {
  return DM_DELIVERY_STORE_PREFIX + user.trim().toLowerCase();
}

// Monotonic bind token (#866). Every bind increments this counter and captures
// its own id; any async continuation (the getItem -> hydrate, and the persist
// callback) no-ops once a newer bind has superseded it. This guards the
// cross-account race: account B binding while account A's getItem is still
// in-flight must not let A's late continuation clobber B's in-memory statuses
// or detach B's persist hook. The newest bind always wins.
let latestBindToken = 0;

// Optional cancellation signal so the caller's useEffect cleanup can abort an
// in-flight bind across the async boundary (#866). When the signal aborts, the
// bind no-ops before hydrating / installing the persist hook.
export interface BindOptions {
  signal?: AbortSignal;
}

/**
 * Bind the eventId-keyed delivery store to AsyncStorage for `user`: hydrate the
 * in-memory map from disk, then install a debounced persist hook so every
 * settle is durably written. Returns a teardown that flushes + detaches the
 * persist hook (call on logout / account switch).
 *
 * Race-safe (#866): each call owns a closure-local debounce timer (never shared
 * across binds) and a monotonic bind token. If a newer bind starts — or the
 * passed AbortSignal fires — before this one's async getItem resolves, this
 * bind no-ops: it does NOT hydrate, does NOT install its persist hook, and its
 * teardown clears only its own timer. The newest bind owns the store.
 */
export async function bindDmDeliveryStorePersistence(
  user: string,
  options: BindOptions = {},
): Promise<() => void> {
  const { signal } = options;
  const key = dmDeliveryStoreKey(user);
  const bindToken = ++latestBindToken;

  // True once a newer bind has superseded this one, or the caller aborted.
  const superseded = (): boolean => bindToken !== latestBindToken || !!signal?.aborted;

  // Per-binding (closure-local) debounce timer — NEVER module-scoped (#866).
  // A re-bind during account switch must not let one binding's teardown clear a
  // timer that belongs to a different binding, nor coalesce writes across keys.
  let writeTimer: ReturnType<typeof setTimeout> | null = null;

  const noop = () => {};

  // Always hydrate — even to an empty map — so binding a new account CLEARS the
  // previous user's in-memory statuses. Skipping hydration when there's no blob
  // would leave the prior account's data to be re-persisted under this key
  // (cross-account mixing, #866). hydrateDmDeliveryStore clears before applying.
  let loaded: Record<string, DeliveryStatus> = {};
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, DeliveryStatus>;
      if (parsed && typeof parsed === 'object') loaded = parsed;
    }
  } catch {
    // Unreadable blob — start empty; the next send re-persists.
  }

  // Stale bind: a newer bind (or an abort) landed while our getItem was in
  // flight. Do NOT hydrate or install the persist hook — that would clobber the
  // newer account's statuses / detach its hook. Return an inert teardown.
  if (superseded()) return noop;

  hydrateDmDeliveryStore(loaded);

  const flush = () => {
    void AsyncStorage.setItem(key, JSON.stringify(getPersistableDmDeliveryStatuses())).catch(
      () => {},
    );
  };

  setDmDeliveryPersist(() => {
    // A persist scheduled after a newer bind took over would write our data
    // under our (now-stale) key — drop it. The newest bind owns persistence.
    if (superseded()) return;
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(flush, 250);
  });

  return () => {
    if (writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }
    flush();
    // Only detach if we're still the active binding — a newer bind may have
    // already installed its own hook, which we must not clobber.
    if (!superseded()) setDmDeliveryPersist(null);
  };
}
