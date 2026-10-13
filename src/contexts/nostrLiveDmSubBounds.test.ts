import {
  startLiveDmSubscription as openLiveDmSubscription,
  type LiveDmSubscriptionParams,
} from './nostrLiveDmSub';
import { createLiveSubFollowGateBuffer } from './liveSubFollowGate';
import { nip04PlaintextCache } from './nostrSecretKeyCache';
import { upsertDmMessages } from '../services/dmDb';
import { KNOWN_WRAP_IDS_CAP } from './knownWrapIdsCap';

jest.mock('../services/marmotWelcomeRouter', () => ({ routeMarmotWelcome: jest.fn() }));

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

describe('shared persisted DM id bounds', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(['live', 'replay'] as const)(
    'caps kind-4 ids added by %s without any kind-1059 ingestion',
    async (path) => {
      const setDeferredReplay = jest.fn();
      const params = makeParams({
        followPubkeysRef: { current: new Set([ALICE]) },
        followHydratedRef: { current: true },
        setDeferredReplay,
      });
      startLiveDmSubscription(params);
      await flush(); // startup seeding/capping must finish before filling the set
      const known = params.knownWrapIdsRef.current.set;
      for (let i = 0; i < KNOWN_WRAP_IDS_CAP; i++) known.add(`persisted-${i}`);
      jest.mocked(nip04PlaintextCache.get).mockReturnValue('hello');
      for (let i = 0; i < 3; i++) {
        const id = `new-kind4-${i}`;
        if (path === 'live') {
          capturedOnEvent!({
            id,
            kind: 4,
            pubkey: ALICE,
            created_at: 100,
            tags: [['p', VIEWER]],
            content: 'ciphertext',
          });
        } else {
          setDeferredReplay.mock.calls[0][0]({
            partnerPubkey: ALICE,
            entry: {
              id,
              partnerPubkey: ALICE,
              fromMe: false,
              createdAt: 100,
              text: 'hello',
              wireKind: 4,
            },
          });
        }
        await flush();
        expect(known.size).toBeLessThanOrEqual(KNOWN_WRAP_IDS_CAP);
        expect(known.has(id)).toBe(true);
      }
      expect(known.has('persisted-0')).toBe(false);
      expect(upsertDmMessages).toHaveBeenCalledTimes(3);
      // Retained recent ids still deduplicate relay redelivery.
      capturedOnEvent!({ id: 'new-kind4-2', kind: 4 });
      await flush();
      expect(upsertDmMessages).toHaveBeenCalledTimes(3);
    },
  );
});
