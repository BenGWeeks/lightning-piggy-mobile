import { AbstractRelay } from 'nostr-tools/abstract-relay';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, type VerifiedEvent } from 'nostr-tools/pure';
import { withRelayHealth } from './healthAwarePool';
import { paceRelayReceive } from './nostrRelayReceiveQueue';
import {
  __resetVerifiedEventCache,
  hydrateVerifiedEventCache,
  verifyEventCached,
} from './nostrVerifyCache';

jest.mock('./relayReqLimit', () => ({ discoverRelayReqLimit: async () => undefined }));
jest.mock('./nostrVerifyCache', () => ({
  ...jest.requireActual('./nostrVerifyCache'),
  hydrateVerifiedEventCache: jest.fn(async () => {}),
  flushVerifiedEventCache: jest.fn(async () => {}),
}));
jest.mock('../contexts/nostrDecryptPacing', () => ({
  createYieldScheduler: () => ({
    maybeYield: () => new Promise<void>((resolve) => setTimeout(resolve, 400)),
    dispose: jest.fn(),
  }),
}));

class BudgetPool extends withRelayHealth(SimplePool) {}
const message = (data: unknown[]) => ({ data: JSON.stringify(data) }) as MessageEvent;

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  __resetVerifiedEventCache();
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});

it.each([false, true])(
  'querySync fallback retains received events through delayed hydration (wire EOSE: %s)',
  async (wireEose) => {
    let hydrated!: () => void;
    jest
      .mocked(hydrateVerifiedEventCache)
      .mockImplementationOnce(() => new Promise<void>((resolve) => (hydrated = resolve)));
    const relay = new AbstractRelay('wss://fallback.example.com/', {
      verifyEvent: (event): event is VerifiedEvent => verifyEventCached(event),
    });
    jest.spyOn(relay, 'send').mockResolvedValue();
    paceRelayReceive(relay);
    const pool = new BudgetPool();
    jest.spyOn(pool, 'ensureRelay').mockResolvedValue(relay);
    const result = pool.querySync([relay.url], { kinds: [1059], limit: 2 }, { maxWait: 100 });
    const completed = jest.fn();
    void result.then(completed);
    await jest.advanceTimersByTimeAsync(0);
    const sub = [...relay.openSubs.values()][0];
    const events = ['first', 'second'].map((content) =>
      finalizeEvent({ kind: 1059, created_at: 1, tags: [], content }, new Uint8Array(32).fill(7)),
    );
    for (const event of events) relay._onmessage(message(['EVENT', sub.id, event]));
    if (wireEose) relay._onmessage(message(['EOSE', sub.id]));

    // Both SDK EOSE and the 100 + 5000 ms fallback have expired, but the
    // messages already received must stay alive until hydration and delivery.
    await jest.advanceTimersByTimeAsync(5100);
    expect(completed).not.toHaveBeenCalled();
    expect(relay.openSubs.size).toBe(1);
    hydrated();
    await jest.advanceTimersByTimeAsync(3000);
    expect((await result).map((event) => event.id)).toEqual(events.map((event) => event.id));
    expect(completed).toHaveBeenCalledTimes(1);
    expect(relay.openSubs.size).toBe(0);
    pool.destroy();
    relay.close();
  },
);
