// Tests for the Amethyst-style realtime background DM watch (#279 realtime
// upgrade). The relay subscription, identity/relay storage, notification
// service, profile cache, and NIP-17 unwrap are all mocked so we assert the
// signer-gating + fresh-arrival + contentless logic without network or
// native modules.

const mockSubscribe = jest.fn();
const mockLoadIdentities = jest.fn();
const mockGetUserRelays = jest.fn();
const mockFireMessageNotification = jest.fn().mockResolvedValue('id');
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
jest.mock('./identitiesStore', () => ({ loadIdentities: () => mockLoadIdentities() }));
jest.mock('./nostrRelayStorage', () => ({ getUserRelays: () => mockGetUserRelays() }));
jest.mock('./nostrService', () => ({
  decodeNsec: (...a: unknown[]) => mockDecodeNsec(...a),
  fetchProfile: (...a: unknown[]) => mockFetchProfile(...a),
}));
jest.mock('./dmLiveSubscription', () => ({
  subscribeInboxDmsForViewer: (...a: unknown[]) => mockSubscribe(...a),
}));
jest.mock('./notificationService', () => ({
  fireMessageNotification: (...a: unknown[]) => mockFireMessageNotification(...a),
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
  __isWatchActiveForTests,
  __resetForTests,
} from './backgroundDmService';

const ME = 'a'.repeat(64);
const PARTNER = 'b'.repeat(64);
const READ_RELAYS = [{ url: 'wss://r.example', read: true, write: true }];
const SECRET = new Uint8Array(32);

// Grab the onEvent handler the service registered with the subscription.
function capturedOnEvent(): (ev: unknown) => void {
  const call = mockSubscribe.mock.calls.at(-1);
  return (call?.[0] as { onEvent: (ev: unknown) => void }).onEvent;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetForTests();
  mockSubscribe.mockReturnValue(() => {});
  mockGetUserRelays.mockResolvedValue(READ_RELAYS);
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

  it('returns false when there are no read relays', async () => {
    mockLoadIdentities.mockResolvedValue(nsecIdentity());
    mockGetUserRelays.mockResolvedValue([]);
    expect(await runBackgroundDmWatch()).toBe(false);
    expect(mockSubscribe).not.toHaveBeenCalled();
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

  it('falls back to contentless when the nsec fails to decode', async () => {
    mockLoadIdentities.mockResolvedValue(nsecIdentity());
    mockDecodeNsec.mockImplementation(() => {
      throw new Error('bad nsec');
    });

    await runBackgroundDmWatch();
    await capturedOnEvent()({ id: 'w5', kind: 1059 });
    await Promise.resolve();

    expect(mockFireMessageNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New encrypted message' }),
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
