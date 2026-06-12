import { useSyncExternalStore, useMemo } from 'react';
import type { ConversationMessageInput } from '../utils/conversationItems';
import {
  getDmDeliveryStatus,
  getAllDmDeliveryStatuses,
  subscribeDmDelivery,
} from '../utils/dmDeliveryStore';

/**
 * Resolve each SENT message's delivery status from the eventId-keyed store
 * (#857), re-running whenever the store settles a status OR `messages` changes.
 *
 * The store is keyed by the stable rumor eventId, carried on each sent row as
 * `rumorId` — identical on the optimistic bubble and the relay echo (whose own
 * `id` is the random OUTER wrap id, so it can't be the key). So the lookup is
 * `store.get(m.rumorId)`, independent of the local- → echo id swap and the ~10s
 * re-fetch that used to strip the tick. A row's own persisted `deliveryStatus`
 * is the fallback for legacy rows sent before the store existed (or restored
 * from the conv cache before the store rehydrates).
 *
 * `useSyncExternalStore` subscribes us to the store and returns its snapshot
 * (stable identity per change). Threading that snapshot through the `useMemo`
 * deps is load-bearing: without it the resolve memo wouldn't re-run on a settle
 * (only on a `messages` change), so the tick would be stuck on its first value.
 */
export function useResolvedDmDeliveries(
  messages: ConversationMessageInput[],
): ConversationMessageInput[] {
  const snapshot = useSyncExternalStore(
    subscribeDmDelivery,
    getAllDmDeliveryStatuses,
    getAllDmDeliveryStatuses,
  );

  return useMemo(() => {
    let changed = false;
    const resolved = messages.map((m) => {
      // Only sent messages carry a delivery tick. Received rows never appear in
      // the store, so the lookup is a cheap miss. Key by `rumorId` (the stable
      // inner-event id), falling back to `id` for legacy optimistic rows.
      if (!m.fromMe) return m;
      const stored = getDmDeliveryStatus(m.rumorId ?? m.id);
      const status = stored ?? m.deliveryStatus;
      if (status === m.deliveryStatus) return m;
      changed = true;
      return { ...m, deliveryStatus: status };
    });
    return changed ? resolved : messages;
    // `snapshot` is intentionally in the deps: it changes identity on every
    // store settle, which is what re-runs this resolve so a tick can update.
    // The lint rule can't see it's load-bearing (it's read via the getter, not
    // the variable), so silence the false positive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, snapshot]);
}
