import { startLiveDmSubscription, type LiveDmSubscriptionParams } from './nostrLiveDmSub';
import { createLiveSubFollowGateBuffer } from './liveSubFollowGate';
import { upsertDmMessages } from '../services/dmDb';

import { setKnownGroups, setSyntheticGroupReconciler } from '../services/groupRoutingRegistry';
import { appendGroupMessage } from '../services/groupMessagesStorageService';
import { notifyGroupMessage } from './nostrEventBus';
import type { DeferredFollowGateEntry } from './liveSubFollowGate';
import { syntheticGroupIdForParticipants } from '../utils/syntheticGroupId';

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
  appendGroupMessage: jest.fn(async () => {}),
  listPersistedGroupWrapIds: jest.fn(async () => [] as string[]),
}));
jest.mock('./dmStoreMigrationRunner', () => ({
  ensureDmStoreMigrated: jest.fn(async () => {}),
}));

const mockNotifyDm = jest.fn();
jest.mock('./nostrEventBus', () => ({
  notifyDmMessage: (...a: unknown[]) => mockNotifyDm(...a),
  notifyGroupMessage: jest.fn(),
}));
const mockFireNotification = jest.fn();
jest.mock('../services/notificationService', () => ({
  fireMessageNotification: (...a: unknown[]) => mockFireNotification(...a),
  isThreadActivelyViewed: jest.fn(() => false),
}));
jest.mock('./knownWrapIdsCap', () => ({ capKnownWrapIds: jest.fn() }));
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

jest.mock('../utils/nip17Unwrap', () => ({
  ...jest.requireActual('../utils/nip17Unwrap'),
  unwrapWrapNsec: (wrap: { rumor?: unknown }) => wrap.rumor ?? null,
}));
jest.mock('../services/nostrCrypto', () => ({
  nip44DecryptFrom: jest.fn(),
  nostrGetEventHash: () => 'rumor-id',
}));
jest.mock('../services/dmWrapNotificationDedupe', () => ({
  claimWrapNotification: jest.fn(() => true),
  markWrapHandled: jest.fn(),
  takeContentlessWrapAlert: jest.fn(),
  noteLiveDmSubArmed: jest.fn(),
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

beforeEach(() => {
  jest.clearAllMocks();
  setKnownGroups([], VIEWER);
});
afterEach(() => {
  setKnownGroups([]);
  setSyntheticGroupReconciler(null);
});

it.each([false, true])(
  'routes a subject-tagged arrival through group storage after follow hydration (teardown=%s)',
  async (teardownBeforeHydration) => {
    const reconcile = jest.fn(async (input) => ({
      id: input.groupId,
      name: input.name,
      memberPubkeys: input.memberPubkeys,
      createdAt: 1,
      updatedAt: 1,
    }));
    setSyntheticGroupReconciler(reconcile, VIEWER);
    const params = makeParams();
    let replay: ((item: DeferredFollowGateEntry) => void) | null = null;
    params.setDeferredReplay = (fn) => {
      replay = fn;
    };
    const stop = startLiveDmSubscription(params);
    await flush();
    const now = Math.floor(Date.now() / 1000);
    capturedOnEvent!({
      id: 'hydrating-group-wrap',
      kind: 1059,
      pubkey: ALICE,
      created_at: now,
      tags: [],
      content: 'wrapped',
      rumor: {
        pubkey: ALICE,
        kind: 14,
        created_at: now,
        tags: [
          ['p', VIEWER],
          ['subject', 'Family'],
        ],
        content: 'hello while hydrating',
      },
    });
    await flush();
    expect(params.followGateBuffer.size).toBe(1);
    expect(reconcile).not.toHaveBeenCalled();
    expect(appendGroupMessage).not.toHaveBeenCalled();
    expect(params.setDmInbox).not.toHaveBeenCalled();
    expect(mockFireNotification).not.toHaveBeenCalled();
    const registeredReplay = replay!;
    let bufferedItem: DeferredFollowGateEntry | undefined;
    if (teardownBeforeHydration) {
      params.followGateBuffer.reevaluate(new Set([ALICE]), (item) => {
        bufferedItem = item;
      });
      stop();
    }
    params.followPubkeysRef.current = new Set([ALICE]);
    params.followGateBuffer.reevaluate(params.followPubkeysRef.current, registeredReplay);
    if (bufferedItem) registeredReplay(bufferedItem);
    await flush();
    expect(params.followGateBuffer.size).toBe(0);
    expect(params.setDmInbox).not.toHaveBeenCalled();
    expect(upsertDmMessages).not.toHaveBeenCalled();
    expect(mockNotifyDm).not.toHaveBeenCalled();
    if (teardownBeforeHydration) {
      expect(reconcile).not.toHaveBeenCalled();
      expect(appendGroupMessage).not.toHaveBeenCalled();
      expect(notifyGroupMessage).not.toHaveBeenCalled();
      expect(mockFireNotification).not.toHaveBeenCalled();
    } else {
      const groupId = syntheticGroupIdForParticipants([VIEWER, ALICE]);
      const message = {
        id: 'hydrating-group-wrap',
        senderPubkey: ALICE,
        text: 'hello while hydrating',
        createdAt: now,
      };
      expect(reconcile).toHaveBeenCalledTimes(1);
      expect(appendGroupMessage).toHaveBeenCalledWith(VIEWER, groupId, message);
      expect(notifyGroupMessage).toHaveBeenCalledTimes(1);
      expect(notifyGroupMessage).toHaveBeenCalledWith(groupId, message);
      expect(mockFireNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'group',
          threadId: groupId,
          title: 'Family',
          body: message.text,
          data: { groupId, senderPubkey: ALICE },
        }),
      );
      params.followGateBuffer.reevaluate(params.followPubkeysRef.current, registeredReplay);
      await flush();
      expect(appendGroupMessage).toHaveBeenCalledTimes(1);
      expect(mockFireNotification).toHaveBeenCalledTimes(1);
      stop();
    }
  },
);
