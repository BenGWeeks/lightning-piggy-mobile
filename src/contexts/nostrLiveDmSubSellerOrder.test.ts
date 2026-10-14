// Seller exception on the live PLAINTEXT order path (#market): a stranger's
// order for one of my own listings raises "New order: …"; anything else is
// stored silently (anti-spam gate). Harness mirrors
// nostrLiveDmSubFollowGate.test.ts.

import {
  startLiveDmSubscription as openLiveDmSubscription,
  type LiveDmSubscriptionParams,
} from './nostrLiveDmSub';
import { createLiveSubFollowGateBuffer } from './liveSubFollowGate';
import { hasConversationWith, upsertDmMessages } from '../services/dmDb';

jest.mock('../services/marmotWelcomeRouter', () => ({
  routeMarmotWelcome: jest.fn(async (rumor: { kind: number }) => rumor.kind === 444),
}));

const mockSubscribe = jest.fn();
let capturedOnEvent: ((ev: unknown) => void) | null = null;
const mockUnsub = jest.fn();
jest.mock('../services/dmLiveSubscription', () => ({
  subscribeInboxDmsForViewer: (input: { onEvent: (ev: unknown) => void }) => {
    capturedOnEvent = input.onEvent;
    mockSubscribe(input);
    return mockUnsub;
  },
}));

jest.mock('../services/dmDb', () => ({
  selectDmWrapIds: jest.fn(async () => [] as string[]),
  hasConversationWith: jest.fn(async () => true),
  upsertDmMessages: jest.fn(async () => {}),
}));
jest.mock('../services/groupMessagesStorageService', () => ({
  listPersistedGroupWrapIds: jest.fn(async () => [] as string[]),
}));
jest.mock('./dmStoreMigrationRunner', () => ({
  ensureDmStoreMigrated: jest.fn(async () => {}),
}));

const mockNotifyDm = jest.fn();
jest.mock('./nostrEventBus', () => ({
  notifyDmMessage: (...a: unknown[]) => mockNotifyDm(...a),
}));
const mockFireNotification = jest.fn();
jest.mock('../services/notificationService', () => ({
  fireMessageNotification: (...a: unknown[]) => mockFireNotification(...a),
}));
jest.mock('./nostrGroupRouting', () => ({
  tryRouteGroupRumor: jest.fn(async () => ({ kind: 'not-group' })),
}));
jest.mock('./knownWrapIdsCap', () => ({ capKnownWrapIds: jest.fn() }));
const mockSellerSignal = jest.fn(async (..._args: unknown[]) => null as unknown);
jest.mock('../services/ownListingIndex', () => ({
  sellerOrderSignal: (...a: unknown[]) => mockSellerSignal(...a),
}));
jest.mock('./nostrDecryptPacing', () => ({
  createYieldScheduler: jest.fn(() => ({
    maybeYield: jest.fn(async () => {}),
    get yieldCount() {
      return 0;
    },
    dispose: jest.fn(),
  })),
  NIP17_LOOP_YIELD_EVERY: 2,
}));

// nsec unwrap returns a handcrafted rumor; partner/text derive from it.
jest.mock('../utils/nip17Unwrap', () => ({
  unwrapWrapNsec: (wrap: { rumor?: unknown }) => wrap.rumor ?? null,
  unwrapWrapViaNip44: jest.fn(),
  partnerFromRumor: (rumor: { partnership?: { partnerPubkey: string; fromMe: boolean } }) =>
    rumor.partnership ?? null,
  textForRumor: (rumor: { content: string }) => rumor.content,
  rumorEventId: (rumor: { id?: string }) => rumor.id ?? 'rumor-id',
}));

jest.mock('./nostrSecretKeyCache', () => ({
  nip04PlaintextCache: { get: jest.fn(), set: jest.fn() },
  getMemoisedSecretKey: jest.fn(async () => new Uint8Array(32)),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
}));

jest.mock('./nostrDmCache', () => ({
  COLD_INITIAL_WRAP_LIMIT: 50,
  DM_INBOX_CAP: 200,
  inboxCacheKey: (pk: string) => `inbox_${pk}`,
  inboxLastSeenKey: (pk: string) => `seen_${pk}`,
  safeGetDmCacheItem: jest.fn(async () => null),
  loadLastSeen: jest.fn(async () => undefined),
  mergeInboxEntries: (prev: unknown[], batch: unknown[]) => [...prev, ...batch],
}));

const subscriptions = new Set<() => void>();
function startLiveDmSubscription(params: LiveDmSubscriptionParams) {
  const stop = openLiveDmSubscription(params);
  const teardown = () => {
    subscriptions.delete(teardown);
    stop();
  };
  subscriptions.add(teardown);
  return teardown;
}
afterEach(() => {
  for (const stop of subscriptions) stop();
});

const VIEWER = 'f'.repeat(64);
const ALICE = 'a'.repeat(64);

function flush(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

function makeParams(overrides: Partial<LiveDmSubscriptionParams> = {}): LiveDmSubscriptionParams {
  const buffer = createLiveSubFollowGateBuffer();
  return {
    viewerPubkey: VIEWER,
    activeSigner: 'nsec',
    pubkey: VIEWER,
    signerType: 'nsec',
    readRelays: ['wss://relay.example'],
    knownWrapIdsRef: { current: { pubkey: null, set: new Set<string>() } },
    followPubkeysRef: { current: new Set<string>() },
    setDmInbox: jest.fn(),
    setAmberNip44Permission: jest.fn(),
    followGateBuffer: buffer,
    setDeferredReplay: jest.fn(),
    ...overrides,
  } as LiveDmSubscriptionParams;
}

describe('live plaintext order — seller exception to the notification gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(upsertDmMessages).mockReset().mockResolvedValue(undefined);
    // A stranger: not followed, no prior conversation.
    jest.mocked(hasConversationWith).mockResolvedValue(false);
  });
  afterEach(() => {
    jest.mocked(hasConversationWith).mockResolvedValue(true);
    mockSellerSignal.mockResolvedValue(null);
  });

  const newOrder = () => ({
    id: 'plain-order',
    kind: 16,
    pubkey: ALICE,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['p', VIEWER],
      ['type', '1'],
      ['order', 'order-9'],
      ['amount', '4200'],
      ['item', `30402:${VIEWER}:mug`, '2'],
    ],
    content: '',
  });

  it('notifies "New order: …" when the order is for my own listing', async () => {
    mockSellerSignal.mockResolvedValue({ kind: 'order', lines: [{ title: 'Mug', quantity: 2 }] });
    const teardown = startLiveDmSubscription(makeParams());
    await flush();
    capturedOnEvent!(newOrder());
    await flush();
    await flush();
    expect(upsertDmMessages).toHaveBeenCalledTimes(1);
    expect(mockFireNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'New order: Mug × 2',
        data: expect.objectContaining({ conversationPubkey: ALICE, messageId: 'plain-order' }),
      }),
    );
    teardown();
  });

  it('stays silent (stored only) when the order is not for my listing', async () => {
    mockSellerSignal.mockResolvedValue(null);
    const teardown = startLiveDmSubscription(makeParams());
    await flush();
    capturedOnEvent!(newOrder());
    await flush();
    await flush();
    expect(upsertDmMessages).toHaveBeenCalledTimes(1);
    expect(mockFireNotification).not.toHaveBeenCalled();
    teardown();
  });
});
