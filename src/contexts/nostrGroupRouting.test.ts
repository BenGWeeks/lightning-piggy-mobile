import { tryRouteGroupRumor } from './nostrGroupRouting';
import { createLiveRumorSurfacer } from './liveDmRumorSurface';
import { ingestInboxWraps } from './dmWrapIngest';
import { setKnownGroups, setSyntheticGroupReconciler } from '../services/groupRoutingRegistry';
import { appendGroupMessage } from '../services/groupMessagesStorageService';
import { upsertDmMessages } from '../services/dmDb';
import { routeMarmotWelcome } from '../services/marmotWelcomeRouter';
import { fireMessageNotification } from '../services/notificationService';
import { notifyGroupMessage } from './nostrEventBus';
import { textForRumor, type DecodedRumor } from '../utils/nip17Unwrap';
import { NWC_SHARE_KIND, serializeNwcShare } from '../utils/nwcShareMessage';

jest.mock('../services/groupMessagesStorageService', () => ({ appendGroupMessage: jest.fn() }));
jest.mock('../services/dmDb', () => ({
  selectKnownEventIds: jest.fn(async () => new Set()),
  upsertDmMessages: jest.fn(async () => undefined),
}));
jest.mock('../services/marmotWelcomeRouter', () => ({ routeMarmotWelcome: jest.fn() }));
jest.mock('../services/notificationService', () => ({
  fireMessageNotification: jest.fn(async () => 'notification'),
  isThreadActivelyViewed: jest.fn(() => false),
}));
jest.mock('../services/dmWrapNotificationDedupe', () => ({
  claimWrapNotification: jest.fn(() => true),
  markWrapHandled: jest.fn(),
  takeContentlessWrapAlert: jest.fn(),
}));
jest.mock('./nostrEventBus', () => ({
  notifyDmMessage: jest.fn(),
  notifyGroupMessage: jest.fn(),
}));
jest.mock('../services/nostrCrypto', () => ({
  nip44DecryptFrom: jest.fn(),
  nostrGetEventHash: () => 'rumor-id',
}));

const ME = 'a'.repeat(64);
const PEER = 'b'.repeat(64);
const SECRET = 'd'.repeat(64);
const rumor = (kind: number): DecodedRumor => ({
  pubkey: PEER,
  created_at: 20,
  kind,
  tags: [['p', ME]],
  content: 'hello',
});

beforeEach(() => {
  jest.clearAllMocks();
  setKnownGroups(
    [{ id: 'family', name: 'Family', memberPubkeys: [PEER], createdAt: 1, updatedAt: 1 }],
    ME,
  );
});
afterEach(() => {
  setKnownGroups([]);
  setSyntheticGroupReconciler(null);
});

it.each([15, 444, NWC_SHARE_KIND])(
  'leaves subjectless kind-%s rumors on their specialized DM path despite a matching room',
  async (kind) => {
    expect(await tryRouteGroupRumor(rumor(kind), ME, 'wrap')).toEqual({ kind: 'not-group' });
    expect(appendGroupMessage).not.toHaveBeenCalled();
    expect(notifyGroupMessage).not.toHaveBeenCalled();
  },
);

describe.each([
  ['live', false],
  ['live', true],
  ['refresh', false],
  ['refresh', true],
] as const)('%s receive with a matching two-member room (subject=%s)', (path, hasSubject) => {
  async function receive(message: DecodedRumor) {
    if (hasSubject) message.tags.push(['subject', 'Family']);
    if (path === 'refresh') {
      const result = await ingestInboxWraps({
        owner: ME,
        wraps: [{ id: 'wrap' }],
        unwrap: async () => message,
        passesFollowGate: () => true,
      });
      expect(result.stored).toBe(1);
      return result.entries[0];
    }
    const queueInboxEntry = jest.fn();
    const writes: Promise<void>[] = [];
    const surface = createLiveRumorSurfacer({
      viewerPubkey: ME,
      isCancelled: () => false,
      shouldAbort: () => false,
      followPubkeysRef: { current: new Set([PEER]) },
      followGateBuffer: { defer: jest.fn(), reevaluate: jest.fn(), clear: jest.fn(), size: 0 },
      isFreshArrival: () => true,
      queueInboxEntry,
      knownWrapIds: new Set(),
      chainWrite: (task) => {
        writes.push(task());
      },
    });
    await surface(message, 'wrap');
    await Promise.all(writes);
    return queueInboxEntry.mock.calls[0]?.[0];
  }

  if (!hasSubject) {
    it.each([['subject', ''], ['subject', ' \t\n '], ['subject']])(
      'delivers a two-party message with invalid subject %j and no matching room as a DM',
      async (...subjectTag) => {
        setKnownGroups([], ME);
        const message = rumor(14);
        message.tags.push(subjectTag);
        const entry = await receive(message);
        expect(entry).toMatchObject({ partnerPubkey: PEER, text: 'hello', wireKind: 14 });
        expect(upsertDmMessages).toHaveBeenCalledWith([
          expect.objectContaining({ conversation: PEER, content: 'hello', wireKind: 14 }),
        ]);
        expect(appendGroupMessage).not.toHaveBeenCalled();
        expect(notifyGroupMessage).not.toHaveBeenCalled();
      },
    );
  }

  it('redacts wallet-share previews and notifications while retaining the encrypted-store payload', async () => {
    const content = serializeNwcShare({
      nwcUrl: `nostr+walletconnect://${PEER}?relay=wss%3A%2F%2Frelay.example&secret=${SECRET}`,
      walletName: 'Savings',
    });
    const entry = await receive({ ...rumor(NWC_SHARE_KIND), content });
    expect(entry.text).toBe('🔌 Shared wallet "Savings"');
    expect(JSON.stringify(entry)).not.toContain(SECRET);
    expect(upsertDmMessages).toHaveBeenCalledWith([
      expect.objectContaining({ conversation: PEER, content, wireKind: NWC_SHARE_KIND }),
    ]);
    expect(appendGroupMessage).not.toHaveBeenCalled();
    if (path === 'live') {
      expect(fireMessageNotification).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'dm', body: entry.text }),
      );
      expect(JSON.stringify(jest.mocked(fireMessageNotification).mock.calls)).not.toContain(SECRET);
    }
  });

  it('dispatches a Marmot Welcome to its join handler and keeps it out of group storage', async () => {
    const message = { ...rumor(444), content: 'serialized-mls-welcome' };
    const entry = await receive(message);
    expect(routeMarmotWelcome).toHaveBeenCalledWith(message, ME);
    expect(entry.wireKind).toBe(444);
    expect(entry.text).not.toContain(message.content);
    expect(appendGroupMessage).not.toHaveBeenCalled();
    expect(fireMessageNotification).not.toHaveBeenCalled();
  });

  it('converts encrypted attachment metadata for storage and redacts its preview', async () => {
    const message = rumor(15);
    message.content = 'https://files.example/photo';
    message.tags.push(
      ['file-type', 'image/jpeg'],
      ['decryption-key', SECRET],
      ['decryption-nonce', 'e'.repeat(24)],
    );
    const entry = await receive(message);
    const converted = textForRumor(message);
    expect(converted).toContain('#lpe=1');
    expect(converted).toContain(SECRET);
    expect(upsertDmMessages).toHaveBeenCalledWith([
      expect.objectContaining({ conversation: PEER, content: converted, wireKind: 15 }),
    ]);
    expect(entry.text).toBe('📎 Attachment');
    expect(appendGroupMessage).not.toHaveBeenCalled();
    if (path === 'live') {
      expect(fireMessageNotification).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'dm', body: '📎 Attachment' }),
      );
    }
  });
});

describe.each(['live', 'refresh'] as const)('%s two-party room trust', (path) => {
  it.each([false, true])(
    'requires the follow gate before creating an unknown subject-tagged room (trusted=%s)',
    async (trusted) => {
      setKnownGroups([], ME);
      const reconcile = jest.fn(async (input) => ({
        id: input.groupId,
        name: input.name,
        memberPubkeys: input.memberPubkeys,
        createdAt: 1,
        updatedAt: 1,
      }));
      setSyntheticGroupReconciler(reconcile, ME);
      const message = rumor(14);
      message.tags.push(['subject', 'Unsolicited room']);
      const queueInboxEntry = jest.fn();
      const defer = jest.fn();
      if (path === 'refresh') {
        const result = await ingestInboxWraps({
          owner: ME,
          wraps: [{ id: 'untrusted-wrap' }],
          unwrap: () => message,
          passesFollowGate: (pk) => trusted && pk === PEER,
        });
        expect(result.stored).toBe(0);
        expect(result.entries).toEqual([]);
      } else {
        await createLiveRumorSurfacer({
          viewerPubkey: ME,
          isCancelled: () => false,
          shouldAbort: () => false,
          followPubkeysRef: { current: new Set(trusted ? [PEER] : [SECRET]) },
          followGateBuffer: { defer, reevaluate: jest.fn(), clear: jest.fn(), size: 0 },
          isFreshArrival: () => true,
          queueInboxEntry,
          knownWrapIds: new Set(),
          chainWrite: (task) => void task(),
        })(message, 'untrusted-wrap');
        expect(queueInboxEntry).not.toHaveBeenCalled();
        expect(defer).toHaveBeenCalledTimes(trusted ? 0 : 1);
      }
      expect(upsertDmMessages).not.toHaveBeenCalled();
      if (trusted) {
        expect(reconcile).toHaveBeenCalledTimes(1);
        expect(appendGroupMessage).toHaveBeenCalledTimes(1);
        expect(notifyGroupMessage).toHaveBeenCalledTimes(1);
        expect(fireMessageNotification).toHaveBeenCalledTimes(path === 'live' ? 1 : 0);
      } else {
        expect(reconcile).not.toHaveBeenCalled();
        expect(appendGroupMessage).not.toHaveBeenCalled();
        expect(notifyGroupMessage).not.toHaveBeenCalled();
        expect(fireMessageNotification).not.toHaveBeenCalled();
      }
    },
  );
});
