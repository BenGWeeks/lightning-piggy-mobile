import { pool } from './nostrPool';
import type { VerifiedEvent } from 'nostr-tools/pure';

jest.mock('./relayHealth', () => ({
  hydrateRelayHealth: jest.fn(),
  selectHealthyRelays: (urls: string[]) => urls,
  RELAY_CONNECT_TIMEOUT_MS: 5000,
  recordRelaySuccess: jest.fn(),
  noteNetworkActivity: jest.fn(),
}));
jest.mock('./nostrVerifyCache', () => ({
  hydrateVerifiedEventCache: jest.fn(async () => {}),
  flushVerifiedEventCache: jest.fn(async () => {}),
}));

it('installs pacing before the real SDK binds the socket receive handler', async () => {
  jest.useFakeTimers();
  const originalSocket = global.WebSocket;
  const originalVerifier = pool.verifyEvent;
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    onopen?: () => void;
    onmessage?: (message: MessageEvent) => void;
    send = jest.fn();
    close = jest.fn();
    constructor() {
      sockets.push(this);
    }
  }
  global.WebSocket = FakeSocket as unknown as typeof WebSocket;
  const verify = jest.fn((e: unknown): e is VerifiedEvent => !!e);
  pool.verifyEvent = (event): event is VerifiedEvent => verify(event);
  try {
    const connecting = pool.ensureRelay('wss://paced/');
    sockets[0].onopen!();
    const relay = await connecting;
    const delivered = jest.fn();
    relay.subscribe([{ kinds: [4] }], { id: 'dm', onevent: delivered });
    sockets[0].onmessage!({
      data: JSON.stringify(['EVENT', 'dm', { kind: 4, id: 'a'.repeat(64), created_at: 1 }]).replace(
        'EVENT',
        '\\u0045VENT',
      ),
    } as MessageEvent);
    expect(verify).not.toHaveBeenCalled();
    expect(delivered).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(10);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(delivered).toHaveBeenCalledTimes(1);
  } finally {
    pool.close(['wss://paced/']);
    global.WebSocket = originalSocket;
    pool.verifyEvent = originalVerifier;
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});
