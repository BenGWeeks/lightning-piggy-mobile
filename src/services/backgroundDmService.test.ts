// Tests for the Amethyst-style realtime background DM watch (#279 realtime
// upgrade). The relay subscription, identity/relay storage, notification
// service, profile cache, and NIP-17 unwrap are all mocked so we assert the
// signer-gating + fresh-arrival + contentless logic without network or
// native modules.

const mockSubscribe = jest.fn();
const mockLoadIdentities = jest.fn();
const mockGetUserRelays = jest.fn();
const mockAsyncGetItem = jest.fn();
const mockFireMessageNotification = jest.fn().mockResolvedValue('id');
const mockHasPermission = jest.fn();
const mockShowForeground = jest.fn().mockResolvedValue('fg');
const mockDismissForeground = jest.fn().mockResolvedValue(undefined);
const mockUnwrapWrapNsec = jest.fn();
const mockPartnerFromRumor = jest.fn();
const mockTextForRumor = jest.fn();
const mockDecodeNsec = jest.fn();
const mockFetchProfile = jest.fn().mockResolvedValue(null);
const mockPeekSync = jest.fn().mockReturnValue(null);
const mockGet = jest.fn().mockResolvedValue(null);

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('nostr-tools/nip44', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: (...a: unknown[]) => mockAsyncGetItem(...a) },
}));
jest.mock('./identitiesStore', () => ({ loadIdentities: () => mockLoadIdentities() }));
// mergeRelays is the real one — the relay-resolution fix under test IS the
// defaults + nip65-cache + overrides merge, so don't stub it out.
jest.mock('./nostrRelayStorage', () => ({
  getUserRelays: () => mockGetUserRelays(),
  mergeRelays: jest.requireActual('./nostrRelayStorage').mergeRelays,
}));
jest.mock('./nostrService', () => ({
  decodeNsec: (...a: unknown[]) => mockDecodeNsec(...a),
  fetchProfile: (...a: unknown[]) => mockFetchProfile(...a),
  DEFAULT_RELAYS: ['wss://default.example'],
}));
jest.mock('./dmLiveSubscription', () => ({
  subscribeInboxDmsForViewer: (...a: unknown[]) => mockSubscribe(...a),
}));
jest.mock('./notificationService', () => ({
  fireMessageNotification: (...a: unknown[]) => mockFireMessageNotification(...a),
  hasNotificationPermission: () => mockHasPermission(),
  showForegroundServiceNotification: (...a: unknown[]) => mockShowForeground(...a),
  dismissForegroundServiceNotification: (...a: unknown[]) => mockDismissForeground(...a),
}));
jest.mock('./zapSenderProfileStorage', () => ({
  peekSync: (...a: unknown[]) => mockPeekSync(...a),
  get: (...a: unknown[]) => mockGet(...a),
}));
jest.mock('../utils/nip17Unwrap', () => ({
  unwrapWrapNsec: (...a: unknown[]) => mockUnwrapWrapNsec(...a),
  partnerFromRumor: (...a: unknown[]) => mockPartnerFromRumor(...a),
  textForRumor: (...a: unknown[]) => mockTextForRumor(...a),
}));
jest.mock('./backgroundDmPreference', () => ({ loadBackgroundDmEnabled: jest.fn() }));

import {
  runBackgroundDmWatch,
  startBackgroundDmWatch,
  stopBackgroundDmWatch,
  rearmBackgroundDmWatchForActiveIdentity,
  __isWatchActiveForTests,
  __resetForTests,
} from './backgroundDmService';
import {
  claimWrapNotification,
  __resetForTests as __resetDedupeForTests,
} from './dmWrapNotificationDedupe';

const ME = 'a'.repeat(64);
const PARTNER = 'b'.repeat(64);
const READ_RELAYS = [{ url: 'wss://r.example', read: true, write: true }];
const SECRET = new Uint8Array(32);

// Grab the onEvent handler the service registered with the subscription.
function capturedOnEvent(): (ev: unknown) => void {
  const call = mockSubscribe.mock.calls.at(-1);
  return (call?.[0] as { onEvent: (ev: unknown) => void }).onEvent;
}

// Fire the subscription's EOSE callback — marks the backlog replay settled.
function settleBacklog(): void {
  const call = mockSubscribe.mock.calls.at(-1);
  (call?.[0] as { onEose?: () => void }).onEose?.();
}

// Fire the wrap subscription's close signal (all relays dropped).
function dropWrapsSub(): void {
  const call = mockSubscribe.mock.calls.at(-1);
  (call?.[0] as { onWrapsClose?: (reasons: string[]) => void }).onWrapsClose?.(['relay closed']);
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetForTests();
  __resetDedupeForTests();
  mockSubscribe.mockReturnValue(() => {});
  mockGetUserRelays.mockResolvedValue(READ_RELAYS);
  mockAsyncGetItem.mockResolvedValue(null);
  mockHasPermission.mockResolvedValue(true);
  mockShowForeground.mockResolvedValue('fg');
  mockDecodeNsec.mockReturnValue({ pubkey: ME, secretKey: SECRET });
});

function nsecIdentity() {
  return {
    identities: [{ pubkey: ME, signerType: 'nsec', nsec: 'nsec1xxx', lastUsedAt: 1 }],
    activePubkey: ME,
  };
}
function amberIdentity() {
  return {
    identities: [{ pubkey: ME, signerType: 'amber', lastUsedAt: 1 }],
    activePubkey: ME,
  };
}

describe('runBackgroundDmWatch arming', () => {
  it('returns false with no active identity', async () => {
    mockLoadIdentities.mockResolvedValue({ identities: [], activePubkey: null });
    expect(await runBackgroundDmWatch()).toBe(false);
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('arms on DEFAULT_RELAYS when the user never customised relays (#279 swipe-away bug)', async () => {
    // Regression guard: getUserRelays() alone is only the explicit overrides
    // and is [] for most users — the watch must still arm via the defaults.
    mockLoadIdentities.mockResolvedValue(nsecIdentity());
    mockGetUserRelays.mockResolvedValue([]);
    expect(await runBackgroundDmWatch()).toBe(true);
    expect(mockSubscribe).toHaveBeenCalledWith(
      expect.objectContaining({ relays: ['wss://default.example'] }),
    );
  });

  it('merges the cached NIP-65 list and user overrides into the read set', async () => {
    mockLoadIdentities.mockResolvedValue(nsecIdentity());
    mockGetUserRelays.mockResolvedValue([{ url: 'wss://user.example', read: true, write: true }]);
    mockAsyncGetItem.mockResolvedValue(
      JSON.stringify([
        { url: 'wss://nip65.example', read: true, write: true },
        { url: 'wss://writeonly.example', read: false, write: true },
      ]),
    );
    expect(await runBackgroundDmWatch()).toBe(true);
    const relays = (mockSubscribe.mock.calls.at(-1)?.[0] as { relays: string[] }).relays;
    expect(relays).toEqual(
      expect.arrayContaining([
        'wss://default.example',
        'wss://nip65.example',
        'wss://user.example',
      ]),
    );
    expect(relays).not.toContain('wss://writeonly.example');
  });

  it('arms the live subscription for an nsec identity', async () => {
    mockLoadIdentities.mockResolvedValue(nsecIdentity());
    expect(await runBackgroundDmWatch()).toBe(true);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(__isWatchActiveForTests()).toBe(true);
  });

  it('tears down a prior watch before re-arming (no double subscription)', async () => {
    const unsub = jest.fn();
    mockSubscribe.mockReturnValue(unsub);
    mockLoadIdentities.mockResolvedValue(nsecIdentity());
    await runBackgroundDmWatch();
    await runBackgroundDmWatch();
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledTimes(2);
  });
});

describe('nsec path: content notifications', () => {
  beforeEach(() => {
    mockLoadIdentities.mockResolvedValue(nsecIdentity());
  });

  it('fires a sender-named content notification for a fresh inbound wrap', async () => {
    mockUnwrapWrapNsec.mockReturnValue({
      pubkey: PARTNER,
      created_at: nowSec(),
      kind: 14,
      tags: [],
      content: 'hello there',
    });
    mockPartnerFromRumor.mockReturnValue({ partnerPubkey: PARTNER, fromMe: false });
    mockTextForRumor.mockReturnValue('hello there');
    mockPeekSync.mockReturnValue({ displayName: 'Alice', name: null });

    await runBackgroundDmWatch();
    await capturedOnEvent()({ id: 'w1', kind: 1059 });
    await Promise.resolve();

    expect(mockFireMessageNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'dm',
        threadId: PARTNER,
        title: 'Alice',
        body: 'hello there',
        data: { conversationPubkey: PARTNER },
      }),
    );
  });

  it('skips our own echoes (fromMe)', async () => {
    mockUnwrapWrapNsec.mockReturnValue({
      pubkey: ME,
      created_at: nowSec(),
      kind: 14,
      tags: [],
      content: 'mine',
    });
    mockPartnerFromRumor.mockReturnValue({ partnerPubkey: PARTNER, fromMe: true });

    await runBackgroundDmWatch();
    await capturedOnEvent()({ id: 'w2', kind: 1059 });
    await Promise.resolve();

    expect(mockFireMessageNotification).not.toHaveBeenCalled();
  });

  it('stays silent for stale backlog wraps (old timestamp)', async () => {
    mockUnwrapWrapNsec.mockReturnValue({
      pubkey: PARTNER,
      created_at: nowSec() - 3 * 24 * 60 * 60, // 3 days old
      kind: 14,
      tags: [],
      content: 'old',
    });
    mockPartnerFromRumor.mockReturnValue({ partnerPubkey: PARTNER, fromMe: false });

    await runBackgroundDmWatch();
    await capturedOnEvent()({ id: 'w3', kind: 1059 });
    await Promise.resolve();

    expect(mockFireMessageNotification).not.toHaveBeenCalled();
  });

  it('stays silent when the foreground live sub already claimed the wrap', async () => {
    mockUnwrapWrapNsec.mockReturnValue({
      pubkey: PARTNER,
      created_at: nowSec(),
      kind: 14,
      tags: [],
      content: 'hello there',
    });
    mockPartnerFromRumor.mockReturnValue({ partnerPubkey: PARTNER, fromMe: false });
    mockTextForRumor.mockReturnValue('hello there');

    await runBackgroundDmWatch();
    // Simulate the live sub (same JS context) winning the claim first.
    expect(claimWrapNotification('w-claimed')).toBe(true);
    await capturedOnEvent()({ id: 'w-claimed', kind: 1059 });
    await Promise.resolve();

    expect(mockFireMessageNotification).not.toHaveBeenCalled();
  });

  it('ignores non-1059 kinds (kind-4 / orders left to the foreground sub)', async () => {
    await runBackgroundDmWatch();
    await capturedOnEvent()({ id: 'k4', kind: 4 });
    await Promise.resolve();
    expect(mockUnwrapWrapNsec).not.toHaveBeenCalled();
    expect(mockFireMessageNotification).not.toHaveBeenCalled();
  });
});

describe('remote signer path: contentless notifications', () => {
  it('posts a contentless notification for an Amber identity, never decrypting', async () => {
    mockLoadIdentities.mockResolvedValue(amberIdentity());

    await runBackgroundDmWatch();
    settleBacklog();
    await capturedOnEvent()({ id: 'w4', kind: 1059 });
    await Promise.resolve();

    expect(mockUnwrapWrapNsec).not.toHaveBeenCalled();
    expect(mockFireMessageNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'dm',
        threadId: '__background__',
        title: 'New encrypted message',
        body: 'Open Lightning Piggy to read',
      }),
    );
  });

  it('stays silent for backlog wraps replayed before EOSE (no notification burst on arm)', async () => {
    // Contentless watches can't run the rumor-timestamp freshness gate, so
    // without the EOSE latch every replayed wrap would become a generic
    // notification on enable/boot (Copilot review, PR #958).
    mockLoadIdentities.mockResolvedValue(amberIdentity());

    await runBackgroundDmWatch();
    await capturedOnEvent()({ id: 'backlog-1', kind: 1059 });
    await capturedOnEvent()({ id: 'backlog-2', kind: 1059 });
    await Promise.resolve();
    expect(mockFireMessageNotification).not.toHaveBeenCalled();

    settleBacklog();
    await capturedOnEvent()({ id: 'live-1', kind: 1059 });
    await Promise.resolve();
    expect(mockFireMessageNotification).toHaveBeenCalledTimes(1);
  });

  it('uses the smaller contentless backlog limit when it cannot decrypt', async () => {
    mockLoadIdentities.mockResolvedValue(amberIdentity());
    await runBackgroundDmWatch();
    expect(mockSubscribe).toHaveBeenCalledWith(expect.objectContaining({ wrapsLimit: 10 }));
  });

  it('falls back to contentless when the nsec fails to decode', async () => {
    mockLoadIdentities.mockResolvedValue(nsecIdentity());
    mockDecodeNsec.mockImplementation(() => {
      throw new Error('bad nsec');
    });

    await runBackgroundDmWatch();
    settleBacklog();
    await capturedOnEvent()({ id: 'w5', kind: 1059 });
    await Promise.resolve();

    expect(mockFireMessageNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New encrypted message' }),
    );
  });
});

describe('self-re-arm on relay drop', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockLoadIdentities.mockResolvedValue(nsecIdentity());
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('re-arms with backoff when the wrap subscription closes', async () => {
    await runBackgroundDmWatch();
    expect(mockSubscribe).toHaveBeenCalledTimes(1);

    dropWrapsSub();
    // First retry fires after the 5s base delay.
    await jest.advanceTimersByTimeAsync(5_000);
    expect(mockSubscribe).toHaveBeenCalledTimes(2);
  });

  it('backs off exponentially on rapid failures, resets after a long-lived sub', async () => {
    await runBackgroundDmWatch();
    dropWrapsSub(); // immediate fail (offline-style)
    await jest.advanceTimersByTimeAsync(5_000); // retry 1 (after 5s)
    expect(mockSubscribe).toHaveBeenCalledTimes(2);
    dropWrapsSub(); // fails again immediately
    await jest.advanceTimersByTimeAsync(5_000); // only 5s — retry 2 needs 10s
    expect(mockSubscribe).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(5_000); // 10s total → retry 2
    expect(mockSubscribe).toHaveBeenCalledTimes(3);

    // A sub that survives ≥60s counts as healthy — its drop resets the
    // backoff so the next retry is the base 5s again. (EOSE is NOT the
    // health signal: nostr-tools EOSEs unreachable relays too.)
    await jest.advanceTimersByTimeAsync(61_000);
    dropWrapsSub();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(mockSubscribe).toHaveBeenCalledTimes(4);
  });

  it('does NOT re-arm on the close fired by an intentional stop', async () => {
    const unsub = jest.fn(() => dropWrapsSub());
    mockSubscribe.mockReturnValue(unsub);
    await startBackgroundDmWatch();
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    await stopBackgroundDmWatch();
    // The teardown's own close signal must not schedule anything.
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
  });

  it('safety interval re-arms a live watch periodically', async () => {
    await runBackgroundDmWatch();
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(15 * 60_000);
    expect(mockSubscribe).toHaveBeenCalledTimes(2);
  });
});

describe('rearmBackgroundDmWatchForActiveIdentity (account switch, #288)', () => {
  it('is a no-op when no watch is armed', async () => {
    mockLoadIdentities.mockResolvedValue(nsecIdentity());
    await rearmBackgroundDmWatchForActiveIdentity();
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('swaps the running subscription to the new active identity', async () => {
    const OTHER = 'c'.repeat(64);
    const unsub = jest.fn();
    mockSubscribe.mockReturnValue(unsub);
    mockLoadIdentities.mockResolvedValue(nsecIdentity());
    await runBackgroundDmWatch();

    // Account switch: the registry now reports OTHER as active.
    mockLoadIdentities.mockResolvedValue({
      identities: [{ pubkey: OTHER, signerType: 'nsec', nsec: 'nsec1yyy', lastUsedAt: 2 }],
      activePubkey: OTHER,
    });
    mockDecodeNsec.mockReturnValue({ pubkey: OTHER, secretKey: SECRET });
    await rearmBackgroundDmWatchForActiveIdentity();

    expect(unsub).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledTimes(2);
    expect(mockSubscribe.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ viewerPubkey: OTHER }),
    );
  });
});

describe('start / stop lifecycle', () => {
  it('start posts the foreground chip and arms the watch', async () => {
    mockLoadIdentities.mockResolvedValue(nsecIdentity());
    await startBackgroundDmWatch();
    expect(mockShowForeground).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
  });

  it('hard-stops without arming when notification permission is missing', async () => {
    // Without permission the watch is an invisible battery drain — no chip,
    // no message alerts (Copilot review, PR #958).
    mockLoadIdentities.mockResolvedValue(nsecIdentity());
    mockHasPermission.mockResolvedValue(false);
    await startBackgroundDmWatch();
    expect(mockShowForeground).not.toHaveBeenCalled();
    expect(mockSubscribe).not.toHaveBeenCalled();
    expect(__isWatchActiveForTests()).toBe(false);
  });

  it('does not arm anything when the fallback chip cannot be posted', async () => {
    mockLoadIdentities.mockResolvedValue(nsecIdentity());
    mockShowForeground.mockResolvedValueOnce(null);
    await startBackgroundDmWatch();
    expect(mockSubscribe).not.toHaveBeenCalled();
    expect(__isWatchActiveForTests()).toBe(false);
  });

  it('dismisses the chip when the fallback arm finds nothing to watch', async () => {
    // Arming can fail after the chip is up (no identity / no relays) — the
    // chip must not stay in the shade promising a watch that is not running.
    mockLoadIdentities.mockResolvedValue({ identities: [], activePubkey: null });
    await startBackgroundDmWatch();
    expect(mockShowForeground).toHaveBeenCalledTimes(1);
    expect(mockDismissForeground).toHaveBeenCalledTimes(1);
    expect(__isWatchActiveForTests()).toBe(false);
  });

  it('cleans up the chip when arming throws', async () => {
    mockLoadIdentities.mockRejectedValueOnce(new Error('identities store unavailable'));
    await startBackgroundDmWatch();
    expect(mockDismissForeground).toHaveBeenCalledTimes(1);
    expect(__isWatchActiveForTests()).toBe(false);
  });

  it('stop dismisses the chip and closes the subscription', async () => {
    const unsub = jest.fn();
    mockSubscribe.mockReturnValue(unsub);
    mockLoadIdentities.mockResolvedValue(nsecIdentity());
    await startBackgroundDmWatch();
    await stopBackgroundDmWatch();
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(mockDismissForeground).toHaveBeenCalledTimes(1);
    expect(__isWatchActiveForTests()).toBe(false);
  });
});
