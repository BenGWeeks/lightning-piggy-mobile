import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as nwcService from './nwcService';
import type { Nip47PaymentNotification } from './nwcService';

// Works without Google Play Services (FCM): the NWC websocket already
// streams `payment_received` events from the wallet, and we post a *local*
// notification via the OS NotificationManager. This is why the feature
// works on GrapheneOS and other de-Googled Android builds.
//
// Caveat: Android may suspend the JS runtime once the app has been in the
// background for a while, which stops the websocket and therefore stops
// notifications. A foreground service to keep the socket alive is a
// follow-up; see docs/TROUBLESHOOTING.adoc.

const PAYMENT_CHANNEL_ID = 'payments';
let initialized = false;
let permissionGranted = false;
const subscriptions = new Map<string, () => void>();

export async function init(): Promise<boolean> {
  if (initialized) return permissionGranted;
  initialized = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(PAYMENT_CHANNEL_ID, {
      name: 'Payments',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#F3C340',
      sound: 'default',
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  permissionGranted = status === 'granted';
  return permissionGranted;
}

function formatSats(msats: number): string {
  const sats = Math.floor(msats / 1000);
  return sats.toLocaleString();
}

async function handlePaymentReceived(
  walletAlias: string,
  notification: Nip47PaymentNotification,
): Promise<void> {
  if (!permissionGranted) return;
  const amount = notification.notification?.amount ?? 0;
  const description = notification.notification?.description?.trim();

  await Notifications.scheduleNotificationAsync({
    identifier: notification.notification?.payment_hash,
    content: {
      title: `Received ${formatSats(amount)} sats`,
      body: description ? `${walletAlias} · ${description}` : walletAlias,
      data: {
        walletAlias,
        paymentHash: notification.notification?.payment_hash,
      },
      ...(Platform.OS === 'android' ? { channelId: PAYMENT_CHANNEL_ID } : {}),
    },
    trigger: null,
  });
}

export async function subscribeWallet(walletId: string, walletAlias: string): Promise<void> {
  unsubscribeWallet(walletId);

  const unsub = await nwcService.subscribeNotifications(walletId, (n) => {
    if (n.notification_type !== 'payment_received') return;
    handlePaymentReceived(walletAlias, n).catch((err) => {
      console.warn('[Notifications] Failed to post local notification:', err);
    });
  });

  if (unsub) subscriptions.set(walletId, unsub);
}

export function unsubscribeWallet(walletId: string): void {
  const unsub = subscriptions.get(walletId);
  if (!unsub) return;
  try {
    unsub();
  } catch {
    // best-effort cleanup
  }
  subscriptions.delete(walletId);
}

export function unsubscribeAll(): void {
  for (const walletId of Array.from(subscriptions.keys())) {
    unsubscribeWallet(walletId);
  }
}
