import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
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
    // A background worker may record in a separate JS context, whose listeners
    // can't reach this one: re-read on resume, staggered like other non-urgent
    // resume work (#554).
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = state === 'active' ? setTimeout(load, 3000) : null;
    });
    return () => {
      cancelled = true;
      unsubscribe();
      appStateSub.remove();
      if (resumeTimer) clearTimeout(resumeTimer);
    };
  }, [pubkey]);

  const unreadCount = useMemo(() => entries.filter((e) => !e.read).length, [entries]);

  // Also clears exactly that row's tray notification (a payment row opens
  // Home, which has no screen-specific clearing of its own).
  const markRead = useCallback(
    async (entry: NotificationHistoryEntry) => {
      if (!pubkey) return;
      await markNotificationRead(pubkey, entry.id);
      await dismissNotificationsFor({ historyId: entry.id });
    },
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
