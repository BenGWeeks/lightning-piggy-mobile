// Cold start (#1143): a tray tap can launch the app before the identity has
// hydrated; marking its history row read must wait for it, not give up.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, status: 'granted' }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('id'),
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

import { markHistoryEntryRead } from './notificationService';
import { recordNotification, listNotifications } from './notificationHistory';
import { setActivePubkeyForWalletStorage } from './walletStorageService';

it('marks a cold-start tap read once the identity hydrates', async () => {
  const owner = 'a'.repeat(64);
  await recordNotification(owner, {
    kind: 'payment',
    title: 'Payment received',
    body: '+1 sats',
    id: 'h1',
  });
  const marking = markHistoryEntryRead('h1'); // tapped before hydration
  setActivePubkeyForWalletStorage(owner);
  await marking;
  expect((await listNotifications(owner))[0].read).toBe(true);
});
