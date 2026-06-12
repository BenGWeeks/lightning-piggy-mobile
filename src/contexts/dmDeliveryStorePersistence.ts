import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DeliveryStatus } from '../utils/dmDeliveryStatus';
import {
  hydrateDmDeliveryStore,
  setDmDeliveryPersist,
  getAllDmDeliveryStatuses,
} from '../utils/dmDeliveryStore';

// AsyncStorage key for the per-user eventId-keyed delivery store (#857). One
// JSON blob per account; small (a few dozen recent sends), pruned implicitly by
// the conv-cache cap since stale eventIds simply never re-render.
const DM_DELIVERY_STORE_PREFIX = 'dmDeliveryStore_';

export function dmDeliveryStoreKey(user: string): string {
  return DM_DELIVERY_STORE_PREFIX + user.trim().toLowerCase();
}

// Debounce writes — a single send fires pending → settled → finalized in quick
// succession; coalesce those into one AsyncStorage write per ~250ms.
let writeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Bind the eventId-keyed delivery store to AsyncStorage for `user`: hydrate the
 * in-memory map from disk, then install a debounced persist hook so every
 * settle is durably written. Returns a teardown that flushes + detaches the
 * persist hook (call on logout / account switch). Idempotent per user.
 */
export async function bindDmDeliveryStorePersistence(user: string): Promise<() => void> {
  const key = dmDeliveryStoreKey(user);
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, DeliveryStatus>;
      if (parsed && typeof parsed === 'object') hydrateDmDeliveryStore(parsed);
    }
  } catch {
    // Unreadable blob — start empty; the next send re-persists.
  }

  const flush = () => {
    void AsyncStorage.setItem(key, JSON.stringify(getAllDmDeliveryStatuses())).catch(() => {});
  };

  setDmDeliveryPersist(() => {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(flush, 250);
  });

  return () => {
    if (writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }
    flush();
    setDmDeliveryPersist(null);
  };
}
