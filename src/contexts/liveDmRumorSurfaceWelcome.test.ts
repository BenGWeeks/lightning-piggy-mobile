import { createLiveRumorSurfacer } from './liveDmRumorSurface';
import { routeMarmotWelcome } from '../services/marmotWelcomeRouter';
import { tryRouteGroupRumor } from './nostrGroupRouting';
import { upsertDmMessages } from '../services/dmDb';
jest.mock('../services/marmotWelcomeRouter', () => ({
  routeMarmotWelcome: jest.fn().mockResolvedValue(true),
}));
jest.mock('../services/dmDb', () => ({ upsertDmMessages: jest.fn() }));
jest.mock('./nostrGroupRouting', () => ({ tryRouteGroupRumor: jest.fn() }));
jest.mock('./nostrEventBus', () => ({ notifyDmMessage: jest.fn() }));
jest.mock('../services/notificationService', () => ({
  fireMessageNotification: jest.fn(),
  isThreadActivelyViewed: jest.fn(),
}));
jest.mock('../services/dmWrapNotificationDedupe', () => ({
  takeContentlessWrapAlert: jest.fn(),
  markWrapHandled: jest.fn(),
}));

it.each([true, false])(
  'live routes Welcome before follow-gate or DM storage (followed=%s)',
  async (followed) => {
    jest.clearAllMocks();
    const owner = 'a'.repeat(64),
      peer = 'b'.repeat(64);
    const defer = jest.fn(),
      queueInboxEntry = jest.fn();
    const surface = createLiveRumorSurfacer({
      viewerPubkey: owner,
      isCancelled: () => false,
      shouldAbort: () => false,
      followPubkeysRef: { current: new Set(followed ? [peer] : []) },
      followGateBuffer: { defer, clear: jest.fn(), reevaluate: jest.fn(), size: 0 },
      isFreshArrival: () => true,
      queueInboxEntry,
      knownWrapIds: new Set(),
      chainWrite: jest.fn(),
    });
    const welcome = {
      pubkey: peer,
      kind: 444,
      content: 'secret',
      tags: [['p', owner]],
      created_at: 1,
    };
    await surface(welcome, 'wrap-id');
    expect(routeMarmotWelcome).toHaveBeenCalledWith(
      welcome,
      owner,
      'wrap-id',
      followed,
      true,
      expect.any(Function),
    );
    expect(tryRouteGroupRumor).not.toHaveBeenCalled();
    expect(defer).not.toHaveBeenCalled();
    expect(queueInboxEntry).not.toHaveBeenCalled();
    expect(upsertDmMessages).not.toHaveBeenCalled();
  },
);
