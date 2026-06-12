import { useSyncExternalStore, useCallback } from 'react';
import type { ConversationMessageInput } from '../utils/conversationItems';
import {
  getDmDeliveryStatus,
  getAllDmDeliveryStatuses,
  subscribeDmDelivery,
} from '../utils/dmDeliveryStore';

/**
 * Resolve each SENT message's delivery status from the eventId-keyed store
 * (#857), and re-render the conversation when any status settles.
 *
 * The store is keyed by the stable rumor eventId, carried on each sent row as
 * `rumorId` — identical on the optimistic bubble and the relay echo (whose own
 * `id` is the random OUTER wrap id, so it can't be the key). So the lookup is
 * `store.get(m.rumorId)`, independent of the local- → echo id swap and the ~10s
 * re-fetch that used to strip the tick. A row's own persisted `deliveryStatus`
 * is the fallback for legacy rows sent before the store existed (or restored
 * from the conv cache before the store rehydrates).
 *
 * `useSyncExternalStore` subscribes us to the store; the snapshot is the whole
 * status map (a stable object identity per change), so React bails out of
 * re-render when nothing changed.
 */
export function useDmDeliveryStatuses(): (
  messages: ConversationMessageInput[],
) => ConversationMessageInput[] {
  // Subscribe so the screen re-renders whenever a status is written. We read the
  // whole map as the snapshot; the actual per-row resolution happens in `resolve`.
  useSyncExternalStore(subscribeDmDelivery, getAllDmDeliveryStatuses, getAllDmDeliveryStatuses);

  return useCallback((messages: ConversationMessageInput[]): ConversationMessageInput[] => {
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
  }, []);
}
