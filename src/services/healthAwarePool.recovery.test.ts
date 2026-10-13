import { AbstractRelay } from 'nostr-tools/abstract-relay';
import { SimplePool } from 'nostr-tools/pool';
import type { Event } from 'nostr-tools';
import { withRelayHealth } from './healthAwarePool';
import { createMarmotNetwork } from './marmotNetwork';

jest.mock('./nostrVerifyCache', () => ({
  hydrateVerifiedEventCache: jest.fn(async () => {}),
  flushVerifiedEventCache: jest.fn(async () => {}),
}));
jest.mock('./relayReqLimit', () => ({ discoverRelayReqLimit: async () => undefined }));
jest.mock('./relayHealth', () => ({
  RELAY_CONNECT_TIMEOUT_MS: 5000,
  selectHealthyRelays: (urls: string[]) => urls,
  noteNetworkActivity: jest.fn(),
  recordRelaySuccess: jest.fn(),
  recordRelayFailure: jest.fn(),
  recordRelayConnectionObservation: jest.fn(),
  recordRelayPublish: jest.fn(),
}));
jest.mock('./nostrPool', () => ({
  get pool() {
    return mockPool;
  },
  trackRelays: jest.fn(),
}));
const url = 'wss://recovery.example/';
class TransportPool extends SimplePool {
  socket = new AbstractRelay(url, { verifyEvent: (() => true) as never });
  ensureRelay() {
    return Promise.resolve(this.socket);
  }
}
class RecoveryPool extends withRelayHealth(TransportPool) {}
let mockPool: RecoveryPool;
const event = (id: string, time: number): Event => ({
  id,
  created_at: time,
  kind: 445,
  tags: [['h', 'quiet']],
  content: '',
  pubkey: 'p',
  sig: 's',
});
const history = () =>
  [...mockPool.socket.openSubs.values()].find((s) => s.filters[0].limit === 500)!;
const live = () => [...mockPool.socket.openSubs.values()].find((s) => s.filters[0].limit === 100)!;
beforeEach(() => {
  jest.useFakeTimers({ now: 2_000_000 });
  mockPool = new RecoveryPool();
  jest.spyOn(mockPool.socket, 'send').mockResolvedValue();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  mockPool.destroy();
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});

test.each(['connection failed', 'connection timed out', 'deadline'])(
  'production recovery keeps buffered traffic and cursor after %s, then retries with backoff',
  async (reason) => {
    const next = jest.fn();
    const owner = createMarmotNetwork(() => [url])
      .subscription([url], { kinds: [445], '#h': ['quiet'], since: 100, limit: 500 })
      .subscribe({ next });
    await jest.advanceTimersByTimeAsync(0);
    live().onevent(event('live', 1900));
    if (reason === 'deadline') await jest.advanceTimersByTimeAsync(6000);
    else history().close(reason);
    await jest.advanceTimersByTimeAsync(0);
    expect(next).not.toHaveBeenCalled();
    expect(history()).toBeUndefined();
    await jest.advanceTimersByTimeAsync(999);
    expect(history()).toBeUndefined();
    await jest.advanceTimersByTimeAsync(1);
    expect(history().filters[0].since).toBe(100);
    history().close('connection failed');
    await jest.advanceTimersByTimeAsync(1999);
    expect(history()).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(history().filters[0].since).toBe(100);
    history().onevent(event('commit', 1200));
    history().receivedEose();
    await jest.advanceTimersByTimeAsync(0);
    history().receivedEose(); // successful empty terminal page
    await jest.advanceTimersByTimeAsync(100);
    expect(next.mock.calls.map(([e]) => e.id)).toEqual(['commit', 'live']);
    owner.unsubscribe();
    expect(mockPool.socket.openSubs.size).toBe(0);
    mockPool.destroy();
    await jest.advanceTimersByTimeAsync(12_000);
    expect(jest.getTimerCount()).toBe(0);
  },
);
