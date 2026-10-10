const mockQuerySync = jest.fn();
const mockPublish = jest.fn();

jest.mock('./nostrPool', () => ({
  pool: {
    querySync: (...args: unknown[]) => mockQuerySync(...args),
    publish: (...args: unknown[]) => mockPublish(...args),
  },
  trackRelays: jest.fn(),
}));
jest.mock('./nostrCrypto', () => ({ nip44EncryptForRecipient: jest.fn() }));

import {
  __resetWatcherTransportForTests,
  publishToWatcher,
  watcherPublishTargets,
} from './watcherPushTransport';
import { WATCHER_PUBKEY } from './watcherRegistration';

const wrap = { id: 'w', kind: 1059 } as never;

beforeEach(() => {
  __resetWatcherTransportForTests();
  mockQuerySync.mockReset();
  mockPublish.mockReset();
});

describe('watcherPublishTargets', () => {
  it("prefers the watcher's open inbox relays over auth-gated damus", () => {
    expect(
      watcherPublishTargets(['wss://relay.damus.io', 'wss://nos.lol/', 'wss://relay.primal.net']),
    ).toEqual(['wss://nos.lol', 'wss://relay.primal.net']);
  });

  it('keeps a relay path as written (paths are case-sensitive)', () => {
    expect(watcherPublishTargets(['WSS://Relay.Example.com/Inbox/'])).toEqual([
      'wss://relay.example.com/Inbox',
    ]);
  });

  it('falls back to the defaults, and to damus only when nothing else is listed', () => {
    expect(watcherPublishTargets([])).toEqual(['wss://nos.lol', 'wss://relay.primal.net']);
    expect(watcherPublishTargets(['wss://relay.damus.io'])).toEqual(['wss://relay.damus.io']);
  });
});

describe('publishToWatcher', () => {
  it("publishes to the watcher's kind-10050 relays and reports any acceptance", async () => {
    mockQuerySync.mockResolvedValue([
      {
        created_at: 1,
        tags: [
          ['relay', 'wss://nos.lol'],
          ['relay', 'wss://inbox.example.com'],
        ],
      },
    ]);
    mockPublish.mockReturnValue([Promise.reject(new Error('blocked')), Promise.resolve('ok')]);
    await expect(publishToWatcher(wrap)).resolves.toBe(true);
    expect(mockQuerySync.mock.calls[0][1]).toEqual({
      kinds: [10050],
      authors: [WATCHER_PUBKEY],
      limit: 1,
    });
    expect(mockPublish).toHaveBeenCalledWith(['wss://nos.lol', 'wss://inbox.example.com'], wrap);
    // The inbox list is cached.
    await publishToWatcher(wrap);
    expect(mockQuerySync).toHaveBeenCalledTimes(1);
  });

  it('is false when no relay accepts it, and survives a failed lookup', async () => {
    mockQuerySync.mockRejectedValue(new Error('offline'));
    mockPublish.mockReturnValue([Promise.reject(new Error('x')), Promise.reject(new Error('y'))]);
    await expect(publishToWatcher(wrap)).resolves.toBe(false);
    expect(mockPublish).toHaveBeenCalledWith(['wss://nos.lol', 'wss://relay.primal.net'], wrap);
  });
});
