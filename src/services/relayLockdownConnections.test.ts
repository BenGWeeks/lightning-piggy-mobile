import type { Event } from 'nostr-tools';
import { normalizeURL } from 'nostr-tools/utils';
import { setCurrentUserPubkey } from './nostrActiveAccount';
import { TEST_ACCOUNT_PUBKEYS, TEST_RELAY_URL } from '../config/testRelayLockdown';
import { pool } from './nostrPool';

jest.mock('./relayHealth', () => ({
  RELAY_CONNECT_TIMEOUT_MS: 3000,
  hydrateRelayHealth: jest.fn(),
  selectHealthyRelays: (urls: string[]) => urls,
  recordRelaySuccess: jest.fn(),
  recordRelayFailure: jest.fn(),
  recordRelayConnectionObservation: jest.fn(),
  recordRelayPublish: jest.fn(),
  noteNetworkActivity: jest.fn(),
}));

class PendingSocket {
  static OPEN = 1;
  static sockets: PendingSocket[] = [];
  readyState = 0;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { message: string }) => void;
  messages: unknown[][] = [];
  constructor(readonly url: string) {
    PendingSocket.sockets.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  send(raw: string) {
    const message = JSON.parse(raw) as unknown[];
    this.messages.push(message);
    if (message[0] === 'EVENT') {
      const event = message[1] as Event;
      this.onmessage?.({ data: JSON.stringify(['OK', event.id, true, 'saved']) });
    }
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ message: 'closed' });
  }
}

const originalWebSocket = global.WebSocket;
beforeEach(() => {
  jest.useFakeTimers();
  PendingSocket.sockets = [];
  global.WebSocket = PendingSocket as unknown as typeof WebSocket;
});
afterEach(() => {
  pool.destroy();
  setCurrentUserPubkey(null);
  global.WebSocket = originalWebSocket;
  jest.useRealTimers();
});

it.each([true, false])(
  'keeps author routing through real SDK publish connections (test author: %s)',
  async (testAuthor) => {
    const testPubkey = [...TEST_ACCOUNT_PUBKEYS][0];
    setCurrentUserPubkey(testAuthor ? 'a'.repeat(64) : testPubkey);
    const pending = Promise.all(
      pool.publish(['wss://public.example'], {
        id: 'event',
        pubkey: testAuthor ? testPubkey : 'a'.repeat(64),
      } as Event),
    );
    expect(PendingSocket.sockets.map((socket) => socket.url)).toEqual([
      normalizeURL(testAuthor ? TEST_RELAY_URL : 'wss://public.example'),
    ]);
    PendingSocket.sockets.forEach((socket) => socket.open());
    await jest.advanceTimersByTimeAsync(0);
    await expect(pending).resolves.toEqual(['saved']);
    expect(PendingSocket.sockets[0].messages[0][0]).toBe('EVENT');
  },
);

it('rejects a pre-lockdown market connection before a raw snapshot can send REQ', async () => {
  // Construct the real SDK pool after installing the controlled transport.
  const { acquireMarketListingsPool } =
    jest.requireActual<typeof import('./marketListingsPool')>('./marketListingsPool');
  const lease = acquireMarketListingsPool(['wss://market.example']);
  const subscribed = jest.fn();
  const pending = lease.pool.ensureRelay('wss://market.example').then((relay) => {
    subscribed();
    return relay.subscribe([{ kinds: [30402], limit: 1 }], {});
  });
  const outcome = expect(pending).rejects.toThrow('relay connection closed by us');
  const oldSocket = PendingSocket.sockets[0];
  setCurrentUserPubkey([...TEST_ACCOUNT_PUBKEYS][0]);
  oldSocket.open();
  await outcome;
  expect(oldSocket.readyState).toBe(3);
  expect(oldSocket.messages).toEqual([]);
  expect(subscribed).not.toHaveBeenCalled();
  lease.release();
});
