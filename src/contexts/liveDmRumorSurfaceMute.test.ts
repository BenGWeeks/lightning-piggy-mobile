import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { createLiveRumorSurfacer } from './liveDmRumorSurface';
import { upsertDmMessages } from '../services/dmDb';
import { notifyDmMessage } from './nostrEventBus';
import { toggleMutedSender } from '../services/mutedSenders';
import { listNotifications } from '../services/notificationHistory';
import { __resetForTests } from '../services/dmWrapNotificationDedupe';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('notification'),
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));
jest.mock('../services/dmDb', () => ({ upsertDmMessages: jest.fn().mockResolvedValue(undefined) }));
jest.mock('./nostrEventBus', () => ({ notifyDmMessage: jest.fn() }));
jest.mock('./nostrGroupRouting', () => ({
  tryRouteGroupRumor: jest.fn().mockResolvedValue({ kind: 'not-group' }),
}));
jest.mock('../services/marmotWelcomeRouter', () => ({ routeMarmotWelcome: jest.fn() }));
jest.mock('../services/nostrCrypto', () => ({
  nip44DecryptFrom: jest.fn(),
  nostrGetEventHash: () => 'rumor-id',
}));

it('still stores and surfaces muted inbound DMs in Messages while suppressing notification history and OS alerts', async () => {
  await AsyncStorage.clear();
  __resetForTests();
  const owner = 'a'.repeat(64);
  const peer = 'b'.repeat(64);
  await toggleMutedSender(owner, peer);
  const queueInboxEntry = jest.fn();
  const writes: Promise<void>[] = [];
  const surface = createLiveRumorSurfacer({
    viewerPubkey: owner,
    isCancelled: () => false,
    shouldAbort: () => false,
    followPubkeysRef: { current: new Set([peer]) },
    followGateBuffer: { defer: jest.fn(), reevaluate: jest.fn(), clear: jest.fn(), size: 0 },
    isFreshArrival: () => true,
    queueInboxEntry,
    knownWrapIds: new Set(),
    chainWrite: (task) => {
      writes.push(task());
    },
  });
  await surface(
    {
      pubkey: peer,
      kind: 14,
      content: '[LNbits] hello',
      tags: [['p', owner]],
      created_at: Math.floor(Date.now() / 1000),
    },
    'muted-wrap',
  );
  await Promise.all(writes);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(upsertDmMessages).toHaveBeenCalledWith([
    expect.objectContaining({ owner, sender: peer, content: '[LNbits] hello' }),
  ]);
  expect(queueInboxEntry).toHaveBeenCalledWith(
    expect.objectContaining({ partnerPubkey: peer, text: '[LNbits] hello' }),
  );
  expect(notifyDmMessage).toHaveBeenCalledWith(peer);
  expect(await listNotifications(owner)).toEqual([]);
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});
