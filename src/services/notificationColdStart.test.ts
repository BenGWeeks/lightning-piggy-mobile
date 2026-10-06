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

it('marks a tapped notification read under its own account, not the active one', async () => {
  const a = 'b'.repeat(64);
  const b = 'c'.repeat(64);
  await recordNotification(a, { kind: 'dm', title: 'For A', body: 'x', id: 'ha' });
  setActivePubkeyForWalletStorage(b); // the user switched to account B
  await markHistoryEntryRead('ha', a);
  expect((await listNotifications(a))[0].read).toBe(true);
  setActivePubkeyForWalletStorage(null);
});

it('marks a cold-start tap read once the identity hydrates', async () => {
  const owner = 'a'.repeat(64);
  await recordNotification(owner, {
    kind: 'payment',
    title: 'Payment received',
    body: '+1 sats',
    id: 'h1',
  });
  const marking = markHistoryEntryRead('h1'); // tapped before auto-login
  setActivePubkeyForWalletStorage(null); // NostrProvider's initial publication
  await new Promise((r) => setTimeout(r, 20)); // auto-login takes a moment
  setActivePubkeyForWalletStorage(owner); // the restored account
  await marking;
  expect((await listNotifications(owner))[0].read).toBe(true);
});
