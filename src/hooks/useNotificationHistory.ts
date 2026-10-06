import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNostr } from '../contexts/NostrContext';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeNotificationHistory,
  type NotificationHistoryEntry,
} from '../services/notificationHistory';
import { dismissNotificationsFor } from '../services/notificationService';

/** The active account's notification history (#1143), kept live. */
export function useNotificationHistory() {
  const { pubkey } = useNostr();
  const [entries, setEntries] = useState<NotificationHistoryEntry[]>([]);

  useEffect(() => {
    setEntries([]);
    if (!pubkey) return;
    let cancelled = false;
    // Notifications are rare, so re-reading the (capped) list per change is
    // cheap; the cancel flag drops a read that lands after an account switch.
    const load = () => {
      void listNotifications(pubkey).then((list) => {
        if (!cancelled) setEntries(list);
      });
    };
    load();
    const unsubscribe = subscribeNotificationHistory(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [pubkey]);

  const unreadCount = useMemo(() => entries.filter((e) => !e.read).length, [entries]);

  const markRead = useCallback(
    (id: string) => (pubkey ? markNotificationRead(pubkey, id) : Promise.resolve()),
    [pubkey],
  );

  // Also clears the OS tray, so the launcher dot goes with the in-app badge.
  const markAllRead = useCallback(async () => {
    if (!pubkey) return;
    await markAllNotificationsRead(pubkey);
    await dismissNotificationsFor({ all: true });
  }, [pubkey]);

  return { entries, unreadCount, markRead, markAllRead };
}
