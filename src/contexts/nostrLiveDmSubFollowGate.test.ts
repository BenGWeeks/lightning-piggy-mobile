/**
 * Wiring tests for the live-sub follow-gate race + teardown (#851 F2).
 *
 * These exercise `startLiveDmSubscription` with its data-layer boundaries
 * mocked, pinning the three behaviours the #851 fix introduces:
 *
 *  1. Teardown (which a wipe / account switch triggers) unregisters the
 *     replay hook and clears the follow-gate buffer — atomically with the
 *     sub stopping — so a just-wiped wrap can never replay into the next
 *     identity's inbox.
 *  2. A late live callback that fires AFTER teardown no-ops (doesn't surface
 *     to `setDmInbox`): the live-sub race a wipe-then-resubscribe could hit.
 *  3. A fresh wrap from a not-yet-hydrated (non-followed) partner is buffered
 *     rather than lost; replaying it surfaces the entry.
 */

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

import { startLiveDmSubscription, type LiveDmSubscriptionParams } from './nostrLiveDmSub';
import { createLiveSubFollowGateBuffer } from './liveSubFollowGate';

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

describe('startLiveDmSubscription — follow-gate race + teardown (#851 F2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnEvent = null;
  });

  it('registers a replay hook on open and clears it on teardown', async () => {
    const setDeferredReplay = jest.fn();
    const buffer = createLiveSubFollowGateBuffer();
    const clearSpy = jest.spyOn(buffer, 'clear');

    const teardown = startLiveDmSubscription(
      makeParams({ setDeferredReplay, followGateBuffer: buffer }),
    );
    await flush();

    // Opened: a replay function was registered (non-null).
    expect(setDeferredReplay).toHaveBeenCalledTimes(1);
    expect(typeof setDeferredReplay.mock.calls[0][0]).toBe('function');

    teardown();
    // Teardown unregisters (null) AND clears the buffer — atomic with the sub stopping.
    expect(setDeferredReplay).toHaveBeenLastCalledWith(null);
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(mockUnsub).toHaveBeenCalledTimes(1);
  });

  it('a late live callback after teardown no-ops (does not surface)', async () => {
    const setDmInbox = jest.fn();
    const followPubkeysRef = { current: new Set<string>([ALICE]) };
    const teardown = startLiveDmSubscription(makeParams({ setDmInbox, followPubkeysRef }));
    await flush();
    expect(capturedOnEvent).toBeTruthy();

    // Wipe / account switch tears the sub down.
    teardown();

    // A wrap the relay streams late (the race window) must be ignored.
    capturedOnEvent!({
      id: 'late-wrap',
      kind: 1059,
      pubkey: ALICE,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: 'x',
      rumor: {
        kind: 14,
        created_at: Math.floor(Date.now() / 1000),
        content: 'late hello',
        partnership: { partnerPubkey: ALICE, fromMe: false },
      },
    });
    await flush();
    expect(setDmInbox).not.toHaveBeenCalled();
    // The `cancelled` guard short-circuits before any surface side-effect.
    expect(mockNotifyDm).not.toHaveBeenCalled();
  });

  it('buffers a fresh wrap from a not-yet-followed partner instead of losing it', async () => {
    const setDmInbox = jest.fn();
    // Follows empty — simulating the post-switch hydration window.
    const followPubkeysRef = { current: new Set<string>() };
    const buffer = createLiveSubFollowGateBuffer();
    let replay: ((item: unknown) => void) | null = null;

    startLiveDmSubscription(
      makeParams({
        setDmInbox,
        followPubkeysRef,
        followGateBuffer: buffer,
        setDeferredReplay: (fn) => {
          replay = fn as ((item: unknown) => void) | null;
        },
      }),
    );
    await flush();

    const now = Math.floor(Date.now() / 1000);
    capturedOnEvent!({
      id: 'wrap-1',
      kind: 1059,
      pubkey: ALICE,
      created_at: now,
      tags: [],
      content: 'x',
      rumor: {
        kind: 14,
        created_at: now,
        content: 'hello while hydrating',
        partnership: { partnerPubkey: ALICE, fromMe: false },
      },
    });
    await flush();

    // Dropped by the follow-gate → buffered, not surfaced yet.
    expect(setDmInbox).not.toHaveBeenCalled();
    expect(buffer.size).toBe(1);

    // Follows hydrate: re-evaluate replays the buffered entry → it surfaces.
    // The inbox setter is debounced (queueInboxEntry batches over ~150 ms),
    // so assert the synchronous replay side-effect (notifyDmMessage) + that
    // the buffer drained, which together prove the entry was recovered.
    expect(replay).toBeTruthy();
    mockNotifyDm.mockClear();
    buffer.reevaluate(new Set([ALICE]), replay!);
    expect(mockNotifyDm).toHaveBeenCalledWith(ALICE);
    expect(buffer.size).toBe(0);
  });

  it('an order wrap from a not-yet-followed partner buffers a friendly preview, not raw JSON (#market)', async () => {
    // Regression for the follow-gate deferred path leaking order JSON into the
    // conversation-list preview: the deferred entry must run the order content
    // through `orderPreviewFromContent` (as the non-deferred path does), not
    // surface the raw `textForRumor` blob. A market the user transacted with
    // (a kind-16 order) is virtually never in their follow set, so this path
    // is the common case for marketplace previews.
    const followPubkeysRef = { current: new Set<string>() };
    const buffer = createLiveSubFollowGateBuffer();

    startLiveDmSubscription(makeParams({ followPubkeysRef, followGateBuffer: buffer }));
    await flush();

    const now = Math.floor(Date.now() / 1000);
    // textForRumor is mocked to return rumor.content, so feed it canonical
    // order JSON (what the real textForRumor emits for a kind-16 order).
    const orderJson = JSON.stringify({
      kind: 16,
      type: 'order',
      orderId: 'abc-12345678',
      amountSats: 21,
    });
    capturedOnEvent!({
      id: 'order-wrap',
      kind: 1059,
      pubkey: ALICE,
      created_at: now,
      tags: [],
      content: 'x',
      rumor: {
        kind: 16,
        created_at: now,
        content: orderJson,
        partnership: { partnerPubkey: ALICE, fromMe: false },
      },
    });
    await flush();
    expect(buffer.size).toBe(1);

    // Capture the buffered entry on replay and assert its preview is the
    // human-readable summary, never the raw order-JSON blob.
    let surfaced: { text?: string } | null = null;
    buffer.reevaluate(new Set([ALICE]), (item: unknown) => {
      surfaced = (item as { entry: { text?: string } }).entry;
    });
    expect(surfaced).toBeTruthy();
    expect(surfaced!.text).toMatch(/^🛒 Order Placed/);
    expect(surfaced!.text).not.toContain('{');
  });
});
