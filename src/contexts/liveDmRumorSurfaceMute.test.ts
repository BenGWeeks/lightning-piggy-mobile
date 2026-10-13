import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { createLiveRumorSurfacer } from './liveDmRumorSurface';
import { upsertDmMessages } from '../services/dmDb';
import { notifyDmMessage } from './nostrEventBus';
import { tryRouteGroupRumor } from './nostrGroupRouting';
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
    isFollowHydrated: () => true,
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

it.each([true, false])(
  'includes the routed group sender in mute filtering (muted=%s)',
  async (muted) => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    __resetForTests();
    const owner = 'a'.repeat(64);
    const peer = 'b'.repeat(64);
    if (muted) await toggleMutedSender(owner, peer);
    (tryRouteGroupRumor as jest.Mock).mockResolvedValueOnce({
      kind: 'routed',
      group: { id: 'group-id', name: 'Family' },
      message: { senderPubkey: peer, text: 'Hello', createdAt: 100 },
    });
    const surface = createLiveRumorSurfacer({
      viewerPubkey: owner,
      isCancelled: () => false,
      shouldAbort: () => false,
      isFollowHydrated: () => true,
      followPubkeysRef: { current: new Set() },
      followGateBuffer: { defer: jest.fn(), reevaluate: jest.fn(), clear: jest.fn(), size: 0 },
      isFreshArrival: () => true,
      queueInboxEntry: jest.fn(),
      knownWrapIds: new Set(),
      chainWrite: jest.fn(),
    });
    await surface(
      { pubkey: peer, kind: 14, content: 'Hello', tags: [], created_at: 100 },
      'group-wrap',
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const history = await listNotifications(owner);
    if (muted) {
      expect(history).toEqual([]);
      expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    } else {
      expect(history).toHaveLength(1);
      expect(history[0].data).toMatchObject({ groupId: 'group-id', senderPubkey: peer });
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    }
  },
);
