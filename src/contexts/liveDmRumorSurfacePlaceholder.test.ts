// The background watch's contentless "New encrypted message" (remote signer)
// is a placeholder: once the live sub decrypts the wrap, the real alert
// replaces it — or, when the wrap shows nothing new (our own sent copy), it
// is retracted from the tray and the history.
const mockFire = jest.fn().mockResolvedValue('id');
const mockDismiss = jest.fn().mockResolvedValue(0);
const mockRemove = jest.fn().mockResolvedValue([]);

jest.mock('../services/notificationService', () => ({
  fireMessageNotification: (...a: unknown[]) => mockFire(...a),
  dismissNotificationsFor: (...a: unknown[]) => mockDismiss(...a),
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
