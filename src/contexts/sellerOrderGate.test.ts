// Shop orders use the same follow gate as other untrusted inbound rumors.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import type { Event } from 'nostr-tools';
import { createLiveRumorSurfacer } from './liveDmRumorSurface';
import { ingestInboxWraps } from './dmWrapIngest';
import { selectKnownEventIds, upsertDmMessages } from '../services/dmDb';
import { addSellerEvents, resetSellerStore } from '../services/sellerEventStore';
import { recordSellerInvoice } from '../services/sellerInvoiceStore';
import { listNotifications } from '../services/notificationHistory';
import { __resetForTests } from '../services/dmWrapNotificationDedupe';
import type { DecodedRumor } from '../utils/nip17Unwrap';

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
  selectKnownEventIds: jest.fn(),
}));
jest.mock('./nostrEventBus', () => ({ notifyDmMessage: jest.fn() }));
jest.mock('./nostrGroupRouting', () => ({
  tryRouteGroupRumor: jest.fn().mockResolvedValue({ kind: 'not-group' }),
}));
jest.mock('../services/marmotWelcomeRouter', () => ({
  routeMarmotWelcome: jest.fn().mockResolvedValue(false),
}));
jest.mock('./nostrDecryptPacing', () => ({
  NIP17_LOOP_YIELD_EVERY: 8,
  createYieldScheduler: jest.fn(() => ({
    maybeYield: jest.fn(async () => {}),
    yieldCount: 0,
    dispose: jest.fn(),
  })),
}));
jest.mock('./nostrDmCache', () => ({
  loadNip17SkipSet: jest.fn(async () => new Set<string>()),
  writeNip17SkipSet: jest.fn(async () => {}),
}));

const SELLER = 'a'.repeat(64);
const STRANGER = 'b'.repeat(64);
const OTHER_SELLER = 'c'.repeat(64);

function myListing(d: string, title: string): Event {
  return {
    id: `${d}`.padEnd(64, '0'),
    sig: 'f'.repeat(128),
    kind: 30402,
    pubkey: SELLER,
    created_at: 1,
    content: '',
    tags: [
      ['d', d],
      ['title', title],
      ['price', '2100', 'SATS'],
    ],
  } as Event;
}

function orderRumor(itemRef: string, qty = 2): DecodedRumor {
  return {
    pubkey: STRANGER,
    kind: 16,
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags: [
      ['p', SELLER],
      ['subject', 'Order abc'],
      ['type', '1'],
      ['order', 'order-1'],
      ['amount', '4200'],
      ['item', itemRef, String(qty)],
    ],
  } as DecodedRumor;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  __resetForTests();
  resetSellerStore();
  addSellerEvents(SELLER, [myListing('mug', 'Mug')]);
  (selectKnownEventIds as jest.Mock).mockResolvedValue(new Set());
});

describe('live gift-wrap path', () => {
  function surfacer(followed = false) {
    const writes: Promise<void>[] = [];
    const surface = createLiveRumorSurfacer({
      viewerPubkey: SELLER,
      isCancelled: () => false,
      shouldAbort: () => false,
      isFollowHydrated: () => true,
      // The buyer is a stranger: not followed.
      followPubkeysRef: { current: new Set(followed ? [STRANGER] : []) },
      followGateBuffer: { defer: jest.fn(), reevaluate: jest.fn(), clear: jest.fn(), size: 0 },
      isFreshArrival: () => true,
      queueInboxEntry: jest.fn(),
      knownWrapIds: new Set(),
      seen: new Set(),
      chainWrite: (task) => {
        writes.push(task());
      },
    });
    return { surface, writes };
  }

  it("stores a followed buyer's order and routes its notification to the shop", async () => {
    const { surface, writes } = surfacer(true);
    await surface(orderRumor(`30402:${SELLER}:mug`), 'wrap-mine');
    await Promise.all(writes);
    await new Promise((r) => setTimeout(r, 0));
    expect(upsertDmMessages).toHaveBeenCalledWith([
      expect.objectContaining({ owner: SELLER, conversation: STRANGER, wireKind: 16 }),
    ]);
    const history = await listNotifications(SELLER);
    expect(history).toHaveLength(1);
    expect(history[0].title).toBe('Order for your shop');
    expect(history[0].data).toMatchObject({
      shopOrderId: 'order-1',
      shopBuyerPubkey: STRANGER,
      messageId: 'wrap-mine',
    });
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['my own current listing', `30402:${SELLER}:mug`],
    ["another seller's listing", `30402:${OTHER_SELLER}:mug`],
    ['a listing I no longer have', `30402:${SELLER}:gone`],
    ['a malformed ref', 'mug'],
  ])('keeps the gate for an order naming %s', async (_label, ref) => {
    const { surface, writes } = surfacer();
    await surface(orderRumor(ref), 'wrap-other');
    await Promise.all(writes);
    await new Promise((r) => setTimeout(r, 0));
    expect(upsertDmMessages).not.toHaveBeenCalled();
    expect(await listNotifications(SELLER)).toEqual([]);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("keeps the gate for a stranger's ordinary chat message", async () => {
    const { surface, writes } = surfacer();
    await surface(
      {
        pubkey: STRANGER,
        kind: 14,
        content: 'hi',
        tags: [['p', SELLER]],
        created_at: 1,
      } as DecodedRumor,
      'wrap-chat',
    );
    await Promise.all(writes);
    expect(upsertDmMessages).not.toHaveBeenCalled();
  });

  it("keeps the gate for a stranger's receipt even after I invoiced them", async () => {
    await recordSellerInvoice(SELLER, {
      orderId: 'order-1',
      buyerPubkey: STRANGER,
      walletId: 'w1',
      paymentHash: '0'.repeat(64),
      bolt11: 'lnbc1',
      amountSats: 4200,
      sentAt: 1,
    });
    const { surface, writes } = surfacer();
    await surface(
      {
        pubkey: STRANGER,
        kind: 17,
        created_at: Math.floor(Date.now() / 1000),
        content: '',
        tags: [
          ['p', SELLER],
          ['subject', 'order-receipt'],
          ['order', 'order-1'],
          ['payment', 'lightning', 'lnbc1', '11'.repeat(32)],
        ],
      } as DecodedRumor,
      'wrap-receipt',
    );
    await Promise.all(writes);
    expect(upsertDmMessages).not.toHaveBeenCalled();
  });
});

describe('batch ingest path', () => {
  it('drops stranger orders irrespective of listing ownership', async () => {
    const rumors: Record<string, DecodedRumor> = {
      mine: orderRumor(`30402:${SELLER}:mug`),
      theirs: orderRumor(`30402:${OTHER_SELLER}:mug`),
    };
    const res = await ingestInboxWraps({
      owner: SELLER,
      wraps: [{ id: 'mine' }, { id: 'theirs' }],
      unwrap: async (wrap: { id: string }) => rumors[wrap.id],
      passesFollowGate: () => false,
      skipKey: 'skip',
    });
    expect(res.entries).toEqual([]);
    expect(res.stored).toBe(0);
  });
});
