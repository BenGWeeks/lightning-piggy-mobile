import { AbstractRelay } from 'nostr-tools/abstract-relay';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent } from 'nostr-tools/pure';
import { withRelayHealth } from './healthAwarePool';
import { discoverRelayReqLimit } from './relayReqLimit';
import { querySyncAbortable } from './relayQuery';

jest.mock('./relayReqLimit', () => ({ discoverRelayReqLimit: jest.fn() }));
jest.mock('./relayHealth', () => ({
  RELAY_CONNECT_TIMEOUT_MS: 5000,
  selectHealthyRelays: (urls: string[]) => urls,
  noteNetworkActivity: jest.fn(),
  recordRelaySuccess: jest.fn(),
  recordRelayFailure: jest.fn(),
  recordRelayConnectionObservation: jest.fn(),
  recordRelayPublish: jest.fn(),
}));

const url = 'wss://lifecycle.example/';
const makeRelay = () => {
  const relay = new AbstractRelay(url, { verifyEvent: (() => true) as never });
  jest.spyOn(relay, 'send').mockResolvedValue();
  return relay;
};
class ReplacementPool extends SimplePool {
  socket = makeRelay();
  get registeredRelay() {
    return this.relays.get(url);
  }
  forgetRelay() {
    this.relays.delete(url);
  }
  ensureRelay() {
    this.relays.set(url, this.socket);
    return Promise.resolve(this.socket);
  }
}
class BudgetPool extends withRelayHealth(ReplacementPool) {}
const event = finalizeEvent(
  { kind: 0, created_at: 1, tags: [], content: '{}' },
  new Uint8Array(32).fill(7),
);

beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(discoverRelayReqLimit).mockResolvedValue(undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('asynchronous NIP-11 reduction requeues strict reads until real EVENT/EOSE', async () => {
  let discover!: (max: number) => void;
  jest
    .mocked(discoverRelayReqLimit)
    .mockImplementationOnce(() => new Promise((resolve) => (discover = resolve)));
  const pool = new BudgetPool();
  const relay = pool.socket;
  const settled = jest.fn();
  const read = () =>
    querySyncAbortable(
      pool,
      [url],
      { kinds: [0], limit: 1 },
      {
        maxWait: 10_000,
        rejectOnAllRelaysFailure: true,
        rejectOnTimeout: true,
      },
    );
  const first = read();
  const second = read();
  void first.then(settled, settled);
  void second.then(settled, settled);
  await jest.advanceTimersByTimeAsync(0);
  expect(relay.openSubs.size).toBe(2);
  const interrupted = [...relay.openSubs.values()][0];

  discover(1);
  await jest.advanceTimersByTimeAsync(0);
  expect(relay.openSubs.size).toBe(1);
  expect(settled).not.toHaveBeenCalled();
  expect(relay.openSubs.has(interrupted.id)).toBe(false);

  const remaining = [...relay.openSubs.values()][0];
  remaining.onevent(event);
  remaining.receivedEose();
  await expect(second).resolves.toEqual([event]);
  await jest.advanceTimersByTimeAsync(0);
  expect(relay.openSubs.size).toBe(1);
  const resumed = [...relay.openSubs.values()][0];
  expect(resumed.id).not.toBe(interrupted.id);
  resumed.onevent(event);
  resumed.receivedEose();
  await expect(first).resolves.toEqual([event]);
  expect(settled).toHaveBeenCalledTimes(2);
  expect(relay.openSubs.size).toBe(0);
  pool.destroy();
});

test('delayed old-socket close and notice cannot retire a replacement inbox/group budget', async () => {
  const pool = new BudgetPool();
  pool.socket.onclose = () => pool.forgetRelay();
  const old = await pool.ensureRelay(url);
  const previousClose = jest.fn();
  // The wrapper already owns onclose; retain it to simulate duplicate delivery.
  const oldClose = old.onclose!;
  const retired = jest.fn();
  pool.subscribeMany([url], { kinds: [1059], limit: 100 }, { onclose: retired });
  await jest.advanceTimersByTimeAsync(0);
  expect(old.openSubs.size).toBe(1);
  oldClose();
  expect(retired).toHaveBeenCalledTimes(1);
  expect(old.openSubs.size).toBe(0);

  pool.socket = makeRelay();
  pool.socket.onclose = () => {
    previousClose();
    pool.forgetRelay();
  };
  const replacement = await pool.ensureRelay(url);
  pool.setRelaySubscriptionLimit(url, 2);
  const onclose = jest.fn();
  const inbox = pool.subscribeMany([url], { kinds: [1059], limit: 100 }, { onclose });
  const groups = pool.subscribeMany(
    [url],
    { kinds: [445], '#h': ['group'], limit: 500 },
    { onclose },
  );
  await jest.advanceTimersByTimeAsync(0);
  expect(replacement.openSubs.size).toBe(2);

  oldClose();
  old.onnotice?.('ERROR: too many concurrent REQs');
  await jest.advanceTimersByTimeAsync(0);
  expect(replacement.openSubs.size).toBe(2);
  expect(pool.registeredRelay).toBe(replacement);
  expect(onclose).not.toHaveBeenCalled();
  expect(retired).toHaveBeenCalledTimes(1);
  expect(previousClose).not.toHaveBeenCalled();

  replacement.onclose?.();
  expect(replacement.openSubs.size).toBe(0);
  expect(onclose).toHaveBeenCalledTimes(2);
  expect(previousClose).toHaveBeenCalledTimes(1);
  inbox.close();
  groups.close();
  pool.destroy();
});
