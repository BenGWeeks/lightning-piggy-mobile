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

import {
  startLiveDmSubscription as openLiveDmSubscription,
  type LiveDmSubscriptionParams,
} from './nostrLiveDmSub';
import { act, renderHook } from '@testing-library/react-native';
import { useLiveFollowGate } from './useLiveFollowGate';
import { adoptFollowSnapshot } from '../services/contactFollowFreshness';
import { createLiveSubFollowGateBuffer } from './liveSubFollowGate';
import { createYieldScheduler } from './nostrDecryptPacing';
import { nip04PlaintextCache } from './nostrSecretKeyCache';
import { upsertDmMessages } from '../services/dmDb';

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

describe('startLiveDmSubscription — follow-gate race + teardown (#851 F2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnEvent = null;
  });

  it.each([true, false])(
    'defers live kind-4 from Middle until reconciliation, then surfaces once (fresh=%s, #1458)',
    async (fresh) => {
      const middle = '4b2fcb4e3c30c1363c4af5e3a6adebfe93cd572c3d57c31aaa4479d908612036';
      const follows = { current: new Set(fresh ? [middle] : [ALICE]) }; // cache alone is not hydration
      const hydrated = { current: false };
      const buffer = createLiveSubFollowGateBuffer();
      const setDeferredReplay = jest.fn();
      const setDmInbox = jest.fn();
      jest.mocked(nip04PlaintextCache.get).mockReturnValue('hello from Middle');
      const teardown = startLiveDmSubscription(
        makeParams({
          followPubkeysRef: follows,
          followHydratedRef: hydrated,
          followGateBuffer: buffer,
          setDeferredReplay,
          setDmInbox,
        } as Partial<LiveDmSubscriptionParams>),
      );
      await flush();
      capturedOnEvent!({
        id: `middle-kind4-${fresh}`,
        kind: 4,
        pubkey: middle,
        created_at: Math.floor(Date.now() / 1000) - (fresh ? 0 : 600),
        tags: [['p', VIEWER]],
        content: 'ciphertext',
      });
      await flush();
      expect(setDmInbox).not.toHaveBeenCalled();
      expect(buffer.size).toBe(1);
      follows.current = new Set([middle]);
      hydrated.current = true;
      const replay = setDeferredReplay.mock.calls[0][0];
      buffer.reevaluate(follows.current, replay);
      buffer.reevaluate(follows.current, replay);
      expect(mockNotifyDm).toHaveBeenCalledTimes(1);
      expect(mockNotifyDm).toHaveBeenCalledWith(middle);
      expect(setDmInbox).toHaveBeenCalledTimes(1);
      teardown();
    },
  );

  it('adoption releases buffered kind-4 and 1059 once despite known ids, then Middle passes (#1458)', async () => {
    const middle = '4b2fcb4e3c30c1363c4af5e3a6adebfe93cd572c3d57c31aaa4479d908612036';
    const { result, unmount } = renderHook(() =>
      useLiveFollowGate(new Set<string>(), false, VIEWER),
    );
    const gate = result.current;
    const knownWrapIdsRef = { current: { pubkey: VIEWER, set: new Set<string>() } };
    const teardown = startLiveDmSubscription(
      makeParams({
        followPubkeysRef: gate.followPubkeysRef,
        followHydratedRef: gate.followHydratedRef,
        followGateBuffer: gate.followGateBufferRef.current,
        setDeferredReplay: (fn) => {
          gate.deferredReplayRef.current = fn;
        },
        knownWrapIdsRef,
      }),
    );
    jest.mocked(nip04PlaintextCache.get).mockReturnValue('Middle plaintext');
    await flush();
    const now = Math.floor(Date.now() / 1000) - 600;
    const kind4 = (id: string) => ({
      id,
      kind: 4,
      pubkey: middle,
      created_at: now,
      tags: [['p', VIEWER]],
      content: 'ciphertext',
    });
    capturedOnEvent!(kind4('buffered-middle'));
    capturedOnEvent!({
      id: 'buffered-wrap',
      kind: 1059,
      pubkey: ALICE,
      created_at: now,
      tags: [],
      content: 'ciphertext',
      rumor: {
        kind: 14,
        created_at: now,
        content: 'Alice plaintext',
        partnership: { partnerPubkey: ALICE, fromMe: false },
      },
    });
    await flush();
    expect(gate.followGateBufferRef.current.size).toBe(2);
    expect(mockNotifyDm).not.toHaveBeenCalled();
    knownWrapIdsRef.current.set.add('buffered-middle');
    expect(knownWrapIdsRef.current.set.has('buffered-wrap')).toBe(true);
    const snapshot = {
      createdAt: 1791834639,
      contacts: [middle, ALICE, 'b'.repeat(64)].map((pubkey) => ({
        pubkey,
        relay: null,
        petname: null,
        profile: null,
      })),
    };
    await act(async () => {
      await adoptFollowSnapshot(VIEWER, snapshot);
    });
    await flush();
    expect(mockNotifyDm.mock.calls).toEqual([[middle], [ALICE]]);
    expect(
      jest
        .mocked(upsertDmMessages)
        .mock.calls.flatMap(([rows]) => rows)
        .map(({ eventId, content, wireKind }) => ({ eventId, content, wireKind })),
    ).toEqual([
      { eventId: 'buffered-middle', content: 'Middle plaintext', wireKind: 4 },
      { eventId: 'buffered-wrap', content: 'Alice plaintext', wireKind: 14 },
    ]);
    expect(gate.followGateBufferRef.current.size).toBe(0);
    await act(async () => {
      await adoptFollowSnapshot(VIEWER, snapshot);
    });
    capturedOnEvent!(kind4('buffered-middle'));
    await flush();
    expect(mockNotifyDm).toHaveBeenCalledTimes(2);
    capturedOnEvent!(kind4('middle-after-hydration'));
    await flush();
    expect(mockNotifyDm).toHaveBeenCalledTimes(3);
    expect(mockNotifyDm).toHaveBeenLastCalledWith(middle);
    expect(gate.followGateBufferRef.current.size).toBe(0);
    teardown();
    unmount();
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

  it('un-claims a wrap id from knownWrapIds when teardown lands while parked on the yield (Copilot #1039 review)', async () => {
    // knownWrapIds is claimed eagerly (#505) before the per-wrap budget-gated
    // yield. If teardown (relay-list change / logout) lands while a wrap is
    // parked on that yield, the id must NOT be left "known" — knownWrapIdsRef
    // survives this effect's re-runs (same viewer), so an orphaned claim
    // would silently starve every future live-sub instance of a wrap the
    // store never actually received.
    let releaseYield: (() => void) | null = null;
    (createYieldScheduler as jest.Mock).mockReturnValueOnce({
      maybeYield: () => new Promise<void>((resolve) => (releaseYield = resolve)),
      get yieldCount() {
        return 0;
      },
      dispose: jest.fn(),
    });

    const knownWrapIdsRef = { current: { pubkey: null as string | null, set: new Set<string>() } };
    const followPubkeysRef = { current: new Set<string>([ALICE]) };
    const teardown = startLiveDmSubscription(
      makeParams({ knownWrapIdsRef, followPubkeysRef, followHydratedRef: { current: true } }),
    );
    await flush();
    expect(capturedOnEvent).toBeTruthy();

    const now = Math.floor(Date.now() / 1000);
    capturedOnEvent!({
      id: 'parked-wrap',
      kind: 1059,
      pubkey: ALICE,
      created_at: now,
      tags: [],
      content: 'x',
      rumor: {
        kind: 14,
        created_at: now,
        content: 'hi',
        partnership: { partnerPubkey: ALICE, fromMe: false },
      },
    });
    // Claimed synchronously, before the (parked) yield.
    expect(knownWrapIdsRef.current.set.has('parked-wrap')).toBe(true);

    // Teardown lands while still parked on the yield.
    teardown();
    releaseYield!();
    await flush();

    expect(knownWrapIdsRef.current.set.has('parked-wrap')).toBe(false);

    // Re-arm: a fresh live-sub instance sharing the same knownWrapIdsRef
    // (relay-list change, same viewer). The relay re-streams the wrap; it
    // must be processed and surfaced this time, not deduped away.
    mockNotifyDm.mockClear();
    startLiveDmSubscription(
      makeParams({ knownWrapIdsRef, followPubkeysRef, followHydratedRef: { current: true } }),
    );
    await flush();
    capturedOnEvent!({
      id: 'parked-wrap',
      kind: 1059,
      pubkey: ALICE,
      created_at: now,
      tags: [],
      content: 'x',
      rumor: {
        kind: 14,
        created_at: now,
        content: 'hi',
        partnership: { partnerPubkey: ALICE, fromMe: false },
      },
    });
    await flush();
    expect(mockNotifyDm).toHaveBeenCalledWith(ALICE);
    expect(knownWrapIdsRef.current.set.has('parked-wrap')).toBe(true);
  });
});

describe('live plaintext marketplace order persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(upsertDmMessages).mockReset().mockResolvedValue(undefined);
  });

  const orderEvent = () => ({
    id: 'market-order',
    kind: 16,
    pubkey: ALICE,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['p', VIEWER],
      ['type', '2'],
      ['order', 'order-1'],
      ['amount', '1000'],
      ['payment', 'bolt11', 'lnbc10u1invoice'],
    ],
    content: '',
  });

  it('reloads the conversation only after the live order is stored', async () => {
    let finish!: () => void;
    jest.mocked(upsertDmMessages).mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    const teardown = startLiveDmSubscription(makeParams());
    await flush();
    capturedOnEvent!(orderEvent());
    await flush();
    expect(upsertDmMessages).toHaveBeenCalledTimes(1);
    expect(mockNotifyDm).not.toHaveBeenCalled();
    expect(mockFireNotification).not.toHaveBeenCalled();
    finish();
    await flush();
    expect(mockNotifyDm).toHaveBeenCalledWith(ALICE);
    expect(mockNotifyDm).toHaveBeenCalledTimes(1);
    teardown();
  });

  it('does not announce delivery when persistence fails', async () => {
    jest.mocked(upsertDmMessages).mockRejectedValueOnce(new Error('disk unavailable'));
    const teardown = startLiveDmSubscription(makeParams());
    await flush();
    capturedOnEvent!(orderEvent());
    await flush();
    expect(upsertDmMessages).toHaveBeenCalledTimes(1);
    expect(mockNotifyDm).not.toHaveBeenCalled();
    expect(mockFireNotification).not.toHaveBeenCalled();
    teardown();
  });

  it('does not notify an old identity when persistence completes after teardown', async () => {
    let finish!: () => void;
    jest.mocked(upsertDmMessages).mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    const teardown = startLiveDmSubscription(makeParams());
    await flush();
    capturedOnEvent!(orderEvent());
    await flush();
    expect(upsertDmMessages).toHaveBeenCalledTimes(1);
    teardown();
    finish();
    await flush();
    expect(mockNotifyDm).not.toHaveBeenCalled();
    expect(mockFireNotification).not.toHaveBeenCalled();
  });
});
