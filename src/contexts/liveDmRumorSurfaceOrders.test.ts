import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { createLiveRumorSurfacer } from './liveDmRumorSurface';
import { upsertDmMessages } from '../services/dmDb';
import { admitUnfollowedOrder, ORDER_RUMOR_RATE_LIMIT } from './orderRumorIngest';
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

it.each([false, true])(
  'stores live non-friend orders but gates Messages and alerts (%s)',
  async (includeNonFollows) => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    __resetForTests();
    const owner = 'c'.repeat(64);
    const peer = 'd'.repeat(64);
    const queueInboxEntry = jest.fn();
    const writes: Promise<void>[] = [];
    const surface = createLiveRumorSurfacer({
      viewerPubkey: owner,
      isCancelled: () => false,
      shouldAbort: () => false,
      isFollowHydrated: () => true,
      followPubkeysRef: { current: new Set() },
      followGateBuffer: { defer: jest.fn(), reevaluate: jest.fn(), clear: jest.fn(), size: 0 },
      isFreshArrival: () => true,
      includeNonFollowOrders: () => includeNonFollows,
      queueInboxEntry,
      knownWrapIds: new Set(),
      chainWrite: (task) => {
        writes.push(task());
      },
    });
    await surface(
      {
        pubkey: peer,
        kind: 16,
        content: '',
        created_at: 100,
        tags: [
          ['p', owner],
          ['type', '2'],
          ['order', 'purchase'],
          ['payment', 'lightning', 'lnbc-invoice'],
          ['address', 'PRIVATE DELIVERY ADDRESS'],
        ],
      },
      'invoice-wrap',
    );
    await Promise.all(writes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(upsertDmMessages).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((upsertDmMessages as jest.Mock).mock.calls)).not.toContain(
      'PRIVATE DELIVERY ADDRESS',
    );
    expect(queueInboxEntry).toHaveBeenCalledTimes(includeNonFollows ? 1 : 0);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(
      includeNonFollows ? 1 : 0,
    );
    const history = await listNotifications(owner);
    expect(JSON.stringify(history)).not.toContain('PRIVATE DELIVERY ADDRESS');
    expect(history).toHaveLength(includeNonFollows ? 1 : 0);
  },
);

it('releases rate-limited live orders for a later backfill without storing or surfacing them', async () => {
  jest.clearAllMocks();
  const owner = 'rate-limited-live';
  for (let i = 0; i < ORDER_RUMOR_RATE_LIMIT; i++) admitUnfollowedOrder(owner);
  const releaseWrapClaim = jest.fn();
  const chainWrite = jest.fn();
  const queueInboxEntry = jest.fn();
  const surface = createLiveRumorSurfacer({
    viewerPubkey: owner,
    isCancelled: () => false,
    shouldAbort: () => false,
    isFollowHydrated: () => true,
    followPubkeysRef: { current: new Set() },
    followGateBuffer: { defer: jest.fn(), reevaluate: jest.fn(), clear: jest.fn(), size: 0 },
    isFreshArrival: () => true,
    queueInboxEntry,
    knownWrapIds: new Set(),
    chainWrite,
    releaseWrapClaim,
  });
  await surface(
    {
      pubkey: 'd'.repeat(64),
      kind: 16,
      created_at: 100,
      content: '',
      tags: [
        ['p', owner],
        ['type', '2'],
        ['order', 'purchase'],
      ],
    },
    'limited-wrap',
  );
  expect(releaseWrapClaim).toHaveBeenCalledWith('limited-wrap');
  expect(chainWrite).not.toHaveBeenCalled();
  expect(queueInboxEntry).not.toHaveBeenCalled();
});
