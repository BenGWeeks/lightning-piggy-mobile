import type { Notification } from 'expo-notifications';
import { getActivePubkey } from './walletStorageService';
import { shouldMuteNotification } from './mutedSenders';
import type { NotificationData } from './notificationService';

export async function mutedNotificationPresentation(notification: Notification) {
  const data = notification.request.content.data as NotificationData & {
    kind?: string;
    category?: string;
  };
  if (
    !(await shouldMuteNotification(
      data?.owner ?? getActivePubkey(),
      data,
      data?.kind ?? data?.category,
    ))
  )
    return null;
  return {
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  };
}
