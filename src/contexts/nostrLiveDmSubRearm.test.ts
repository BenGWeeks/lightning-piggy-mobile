/**
 * Wiring tests for the live-sub self-re-arm on socket drop + app resume (#934).
 *
 * The foreground live DM subscription used to arm once per session and never
 * re-establish after a silent WebSocket drop (relay idle, network change,
 * Doze suspending the socket on background/resume) — the user then had to
 * pull-to-refresh to see missed DMs. These tests pin the re-arm behaviour that
 * closes that gap, mirroring the background DM watch's self-re-arm (#958):
 *
 *  1. `onWrapsClose` (the wrap sub closing on every relay) schedules a
 *     backoff-delayed re-open of the subscription.
 *  2. An intentional teardown (logout / account switch / relay-list change)
 *     does NOT re-arm — the close it triggers is stale-generation and no-ops.
 *  3. Returning to `AppState` `active` re-arms proactively (Doze can kill the
 *     socket without ever firing `onWrapsClose`).
 */

import { AppState, type AppStateStatus } from 'react-native';

const mockSubscribe = jest.fn();
// The current sub's onWrapsClose (overwritten on each (re)subscribe). The
// returned per-sub unsub fires THAT sub's onWrapsClose — mirroring the real
// dmLiveSubscription, whose `unsubscribe()` calls `s.close()` → `onclose`.
let capturedOnWrapsClose: ((reasons: string[]) => void) | null = null;
jest.mock('../services/dmLiveSubscription', () => ({
  subscribeInboxDmsForViewer: (input: {
    onEvent: (ev: unknown) => void;
    onWrapsClose?: (reasons: string[]) => void;
  }) => {
    const onClose = input.onWrapsClose ?? null;
    capturedOnWrapsClose = onClose;
    mockSubscribe(input);
    // Real teardown closes the sockets, which fires onclose → onWrapsClose.
    return jest.fn(() => onClose?.([]));
  },
}));

jest.mock('../services/dmDb', () => ({
  selectDmWrapIds: jest.fn(async () => [] as string[]),
  upsertDmMessages: jest.fn(async () => {}),
}));
jest.mock('../services/groupMessagesStorageService', () => ({
  listPersistedGroupWrapIds: jest.fn(async () => [] as string[]),
}));
jest.mock('./dmStoreMigrationRunner', () => ({
  ensureDmStoreMigrated: jest.fn(async () => {}),
}));
jest.mock('./nostrEventBus', () => ({ notifyDmMessage: jest.fn() }));
jest.mock('../services/notificationService', () => ({ fireMessageNotification: jest.fn() }));
jest.mock('../services/dmWrapNotificationDedupe', () => ({
  claimWrapNotification: jest.fn(() => true),
}));
jest.mock('./nostrGroupRouting', () => ({
  tryRouteGroupRumor: jest.fn(async () => ({ kind: 'not-group' })),
}));
jest.mock('./knownWrapIdsCap', () => ({ capKnownWrapIds: jest.fn() }));
jest.mock('./nostrDecryptPacing', () => ({ yieldToEventLoop: jest.fn(async () => {}) }));
jest.mock('../utils/nip17Unwrap', () => ({
  unwrapWrapNsec: jest.fn(),
  unwrapWrapViaNip44: jest.fn(),
  partnerFromRumor: jest.fn(),
  textForRumor: jest.fn(),
  rumorEventId: jest.fn(),
}));
jest.mock('../utils/orderEvents', () => ({
  parseOrderEvent: jest.fn(),
  serializeOrder: jest.fn(),
  orderPreviewText: jest.fn(),
  orderPreviewFromContent: jest.fn(),
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

import { startLiveDmSubscription, type LiveDmSubscriptionParams } from './nostrLiveDmSub';
import { createLiveSubFollowGateBuffer } from './liveSubFollowGate';

const VIEWER = 'f'.repeat(64);

// Drain microtasks (the async seed IIFE) without touching the faked timers.
function flush(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

function makeParams(overrides: Partial<LiveDmSubscriptionParams> = {}): LiveDmSubscriptionParams {
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
    followGateBuffer: createLiveSubFollowGateBuffer(),
    setDeferredReplay: jest.fn(),
    ...overrides,
  } as LiveDmSubscriptionParams;
}

describe('startLiveDmSubscription — self-re-arm on drop / resume (#934)', () => {
  let appStateHandler: ((s: AppStateStatus) => void) | null = null;
  let appStateRemove: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnWrapsClose = null;
    appStateHandler = null;
    appStateRemove = jest.fn();
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_ev, cb: (s: AppStateStatus) => void) => {
        appStateHandler = cb;
        return { remove: appStateRemove } as ReturnType<typeof AppState.addEventListener>;
      });
    // Keep setImmediate real so `flush()` can drain the async seed IIFE.
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('re-arms after the wrap sub closes (socket drop), with backoff', async () => {
    startLiveDmSubscription(makeParams());
    await flush();
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(capturedOnWrapsClose).toBeTruthy();

    // Relay drops the socket → wrap sub closes on every relay.
    capturedOnWrapsClose!([]);
    // Re-arm is backoff-scheduled, not synchronous.
    expect(mockSubscribe).toHaveBeenCalledTimes(1);

    // After the base backoff delay it re-opens the subscription.
    jest.advanceTimersByTime(5_000);
    expect(mockSubscribe).toHaveBeenCalledTimes(2);
  });

  it('does NOT re-arm on intentional teardown (stale-generation close no-ops)', async () => {
    const teardown = startLiveDmSubscription(makeParams());
    await flush();
    expect(mockSubscribe).toHaveBeenCalledTimes(1);

    // Teardown bumps the generation, then its unsubscribe() fires onWrapsClose
    // synchronously — that close is stale and must not schedule a reconnect.
    teardown();
    expect(appStateRemove).toHaveBeenCalledTimes(1);

    // No timer was scheduled; advancing well past the max backoff re-opens nothing.
    jest.advanceTimersByTime(10 * 60_000);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
  });

  it('re-arms on return to AppState active (Doze can kill the socket silently)', async () => {
    startLiveDmSubscription(makeParams());
    await flush();
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(appStateHandler).toBeTruthy();

    // App resumes → proactive re-arm even though onWrapsClose never fired.
    appStateHandler!('active');
    expect(mockSubscribe).toHaveBeenCalledTimes(2);

    // A non-active transition (background) does not re-arm.
    appStateHandler!('background');
    expect(mockSubscribe).toHaveBeenCalledTimes(2);
  });

  it('a close after teardown never re-arms even once cancelled', async () => {
    const teardown = startLiveDmSubscription(makeParams());
    await flush();
    const closeFn = capturedOnWrapsClose!;
    teardown();
    // A late close signal the relay emits after teardown must be inert.
    closeFn([]);
    jest.advanceTimersByTime(10 * 60_000);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
  });
});
