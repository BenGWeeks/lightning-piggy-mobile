// The background watch's contentless "New encrypted message" (remote signer)
// is a placeholder: once the live sub decrypts the wrap, the real alert
// replaces it — or, when the wrap shows nothing new (our own sent copy), it
// is retracted from the tray and the history.
const mockFire = jest.fn().mockResolvedValue('id');
const mockDismiss = jest.fn().mockResolvedValue(0);
const mockRemove = jest.fn().mockResolvedValue([]);
const mockCancelInFlight = jest.fn();

jest.mock('../services/notificationService', () => ({
  fireMessageNotification: (...a: unknown[]) => mockFire(...a),
  dismissNotificationsFor: (...a: unknown[]) => mockDismiss(...a),
  cancelInFlightNotifications: (...a: unknown[]) => mockCancelInFlight(...a),
}));
jest.mock('../services/notificationHistory', () => ({
  removeNotificationsWhere: (...a: unknown[]) => mockRemove(...a),
}));
jest.mock('../services/dmDb', () => ({ upsertDmMessages: jest.fn().mockResolvedValue(undefined) }));
jest.mock('./nostrEventBus', () => ({ notifyDmMessage: jest.fn() }));
jest.mock('./nostrGroupRouting', () => ({
  tryRouteGroupRumor: jest.fn().mockResolvedValue({ kind: 'not-group' }),
}));
jest.mock('../services/marmotWelcomeRouter', () => ({ routeMarmotWelcome: jest.fn() }));
jest.mock('../services/nostrCrypto', () => ({
  nip44DecryptFrom: jest.fn(),
  nostrGetEventHash: () => 'rumor-id',
}));

import { createLiveRumorSurfacer } from './liveDmRumorSurface';
import {
  claimWrapNotification,
  noteContentlessWrapAlert,
  takeContentlessWrapAlert,
  wasWrapHandled,
  __resetForTests,
} from '../services/dmWrapNotificationDedupe';

const ME = 'a'.repeat(64);
const PEER = 'b'.repeat(64);
const now = () => Math.floor(Date.now() / 1000);

function surfacer() {
  return createLiveRumorSurfacer({
    viewerPubkey: ME,
    isCancelled: () => false,
    shouldAbort: () => false,
    followPubkeysRef: { current: new Set([PEER]) },
    followGateBuffer: { defer: jest.fn(), reevaluate: jest.fn(), clear: jest.fn(), size: 0 },
    isFreshArrival: () => true,
    queueInboxEntry: jest.fn(),
    knownWrapIds: new Set(),
    chainWrite: (task) => void task(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetForTests();
});

it('replaces the contentless alert with the real one once decrypted', async () => {
  // The watch posted (and claimed) its contentless alert first.
  claimWrapNotification('w1');
  noteContentlessWrapAlert('w1');
  await surfacer()(
    { pubkey: PEER, created_at: now(), kind: 14, tags: [['p', ME]], content: 'hi' },
    'w1',
  );
  expect(mockFire).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ conversationPubkey: PEER }) }),
  );
  expect(mockDismiss).toHaveBeenCalledWith({ wrapId: 'w1' });
  expect(mockRemove).toHaveBeenCalledWith(ME, expect.any(Function));
  expect(wasWrapHandled('w1')).toBe(true);
});

it('retracts it when the wrap was the copy of our own message', async () => {
  claimWrapNotification('own');
  noteContentlessWrapAlert('own');
  await surfacer()(
    { pubkey: ME, created_at: now(), kind: 14, tags: [['p', PEER]], content: 'sent' },
    'own',
  );
  expect(mockFire).not.toHaveBeenCalled();
  expect(mockDismiss).toHaveBeenCalledWith({ wrapId: 'own' });
  // One still being posted is cancelled too.
  const inFlight = mockCancelInFlight.mock.calls[0][0] as (d: { wrapId?: string }) => boolean;
  expect(inFlight({ wrapId: 'own' })).toBe(true);
  expect(inFlight({ wrapId: 'x' })).toBe(false);
  const match = mockRemove.mock.calls[0][1] as (e: { data: { wrapId?: string } }) => boolean;
  expect(match({ data: { wrapId: 'own' } })).toBe(true);
  expect(match({ data: { wrapId: 'other' } })).toBe(false);
});

it('touches nothing when no contentless alert was posted, and still marks the wrap handled', async () => {
  await surfacer()(
    { pubkey: ME, created_at: now(), kind: 14, tags: [['p', PEER]], content: 'sent' },
    'w2',
  );
  expect(mockDismiss).not.toHaveBeenCalled();
  expect(mockRemove).not.toHaveBeenCalled();
  expect(wasWrapHandled('w2')).toBe(true);
});

it("retracts a stranger's contentless alert at once, but lets a later replay post the real one", async () => {
  claimWrapNotification('stranger');
  noteContentlessWrapAlert('stranger');
  const STRANGER = 'c'.repeat(64);
  await surfacer()(
    { pubkey: STRANGER, created_at: now(), kind: 14, tags: [['p', ME]], content: 'hey' },
    'stranger',
  );
  expect(mockFire).not.toHaveBeenCalled();
  expect(mockDismiss).toHaveBeenCalledWith({ wrapId: 'stranger' });
  // Still noted for the follow-gate replay (which bypasses the watch's claim).
  expect(takeContentlessWrapAlert('stranger')).toBe(true);
});
