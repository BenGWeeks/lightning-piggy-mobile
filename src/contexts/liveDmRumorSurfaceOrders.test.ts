import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { createLiveRumorSurfacer } from './liveDmRumorSurface';
import { getOutgoingOrderRows, upsertDmMessages } from '../services/dmDb';
import { notifyDmMessage } from './nostrEventBus';
import { serializeOrder, parseOrderEvent } from '../utils/orderEvents';
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
jest.mock('../services/dmDb', () => ({
  upsertDmMessages: jest.fn().mockResolvedValue(undefined),
  getOutgoingOrderRows: jest.fn(),
}));

beforeEach(() => {
  (getOutgoingOrderRows as jest.Mock).mockImplementation(async (owner, seller, ids) => [
    {
      owner,
      sender: owner,
      conversation: seller,
      fromMe: true,
      content: serializeOrder(
        parseOrderEvent({
          kind: 16,
          content: '',
          tags: [
            ['type', '1'],
            ['order', ids[0]],
          ],
        })!,
      ),
    },
  ]);
});
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
    expect(notifyDmMessage).toHaveBeenCalledWith(peer);
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

it.each([false, true])(
  'drops an unsolicited live invoice even if the sender is followed (%s)',
  async (followed) => {
    jest.clearAllMocks();
    (getOutgoingOrderRows as jest.Mock).mockResolvedValue([]);
    const chainWrite = jest.fn();
    const queueInboxEntry = jest.fn();
    const surface = createLiveRumorSurfacer({
      viewerPubkey: 'c'.repeat(64),
      isCancelled: () => false,
      shouldAbort: () => false,
      isFollowHydrated: () => true,
      followPubkeysRef: { current: new Set(followed ? ['d'.repeat(64)] : []) },
      followGateBuffer: { defer: jest.fn(), reevaluate: jest.fn(), clear: jest.fn(), size: 0 },
      isFreshArrival: () => true,
      includeNonFollowOrders: () => true,
      queueInboxEntry,
      knownWrapIds: new Set(),
      chainWrite,
    });
    await surface(
      {
        pubkey: 'd'.repeat(64),
        kind: 16,
        created_at: 100,
        content: '',
        tags: [
          ['p', 'c'.repeat(64)],
          ['type', '2'],
          ['order', 'unknown'],
        ],
      },
      'unsolicited-wrap',
    );
    expect(chainWrite).not.toHaveBeenCalled();
    expect(queueInboxEntry).not.toHaveBeenCalled();
    expect(notifyDmMessage).not.toHaveBeenCalled();
  },
);

it('notifies the open order conversation only after persistence completes', async () => {
  jest.clearAllMocks();
  let finishWrite!: () => void;
  (upsertDmMessages as jest.Mock).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishWrite = resolve;
      }),
  );
  const writes: Promise<void>[] = [];
  const surface = createLiveRumorSurfacer({
    viewerPubkey: 'c'.repeat(64),
    isCancelled: () => false,
    shouldAbort: () => false,
    isFollowHydrated: () => true,
    followPubkeysRef: { current: new Set() },
    followGateBuffer: { defer: jest.fn(), reevaluate: jest.fn(), clear: jest.fn(), size: 0 },
    isFreshArrival: () => true,
    queueInboxEntry: jest.fn(),
    knownWrapIds: new Set(),
    chainWrite: (task) => {
      writes.push(task());
    },
  });
  await surface(
    {
      pubkey: 'd'.repeat(64),
      kind: 16,
      created_at: 100,
      content: '',
      tags: [
        ['p', 'c'.repeat(64)],
        ['type', '2'],
        ['order', 'purchase'],
      ],
    },
    'delayed-write',
  );
  expect(notifyDmMessage).not.toHaveBeenCalled();
  finishWrite();
  await Promise.all(writes);
  expect(notifyDmMessage).toHaveBeenCalledTimes(1);
});
