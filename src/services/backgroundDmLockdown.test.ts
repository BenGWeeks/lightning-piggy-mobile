import { setCurrentUserPubkey, getCurrentUserPubkey } from './nostrActiveAccount';
import { TEST_ACCOUNT_PUBKEYS, TEST_RELAY_URL } from '../config/testRelayLockdown';

import { runBackgroundDmWatch, __resetForTests } from './backgroundDmService';
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
const mockCanWatchPayments = jest.fn();
const mockPaymentsRunning = jest.fn();
const mockStartPayments = jest.fn();
const mockStopPayments = jest.fn();
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
jest.mock('./backgroundPaymentService', () => ({
  canWatchBackgroundPayments: () => mockCanWatchPayments(),
  isBackgroundPaymentWatchRunning: () => mockPaymentsRunning(),
  startBackgroundPaymentWatch: (...a: unknown[]) => mockStartPayments(...a),
  stopBackgroundPaymentWatch: (...a: unknown[]) => mockStopPayments(...a),
}));
jest.mock('./backgroundDmPreference', () => ({ loadBackgroundDmEnabled: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  __resetForTests();
  mockSubscribe.mockReturnValue(() => {});
  mockGetUserRelays.mockResolvedValue([{ url: 'wss://public.example', read: true, write: true }]);
  mockAsyncGetItem.mockResolvedValue(null);
  mockHasPermission.mockResolvedValue(true);
});
afterEach(() => {
  __resetForTests();
  setCurrentUserPubkey(null);
});
it('arms saved test identities on LAN when the headless mirror starts empty', async () => {
  const owner = [...TEST_ACCOUNT_PUBKEYS][0];
  setCurrentUserPubkey(null);
  mockLoadIdentities.mockResolvedValue({
    activePubkey: owner,
    identities: [{ pubkey: owner, signerType: 'amber' }],
  });
  expect(await runBackgroundDmWatch()).toBe(true);
  expect(getCurrentUserPubkey()).toBe(owner);
  expect(mockSubscribe.mock.calls.at(-1)[0].relays).toEqual([TEST_RELAY_URL]);
  setCurrentUserPubkey(null);
});

it('does not arm when persisted identities cannot be read', async () => {
  mockLoadIdentities.mockRejectedValueOnce(new Error('locked storage'));
  await expect(runBackgroundDmWatch()).rejects.toThrow('locked storage');
  expect(mockSubscribe).not.toHaveBeenCalled();
});
