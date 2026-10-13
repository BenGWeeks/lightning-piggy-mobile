import { AbstractRelay } from 'nostr-tools/abstract-relay';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, type VerifiedEvent } from 'nostr-tools/pure';
import { querySyncAbortable } from './relayQuery';
import { paceRelayReceive } from './nostrRelayReceiveQueue';
import {
  __resetVerifiedEventCache,
  flushVerifiedEventCache,
  verifyEventCached,
} from './nostrVerifyCache';

// Model a slow uncached receive backlog without blocking the test runner.
jest.mock('../contexts/nostrDecryptPacing', () => ({
  createYieldScheduler: () => ({
    maybeYield: () => new Promise<void>((resolve) => setTimeout(resolve, 400)),
    dispose: jest.fn(),
  }),
}));
jest.mock('./nostrVerifyCache', () => ({
  ...jest.requireActual('./nostrVerifyCache'),
  hydrateVerifiedEventCache: jest.fn(async () => {}),
  flushVerifiedEventCache: jest.fn(async () => {}),
}));

const key = new Uint8Array(32).fill(7);
const message = (data: unknown[]) => ({ data: JSON.stringify(data) }) as MessageEvent;

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  __resetVerifiedEventCache();
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});

async function inboxQuery(params: { signal?: AbortSignal; rejectOnTimeout?: boolean } = {}) {
  const verify = jest.fn(verifyEventCached);
  const relay = new AbstractRelay('wss://inbox/', {
    verifyEvent: (event): event is VerifiedEvent => verify(event),
  });
  jest.spyOn(relay, 'send').mockResolvedValue();
  paceRelayReceive(relay);
  const pool = new SimplePool();
  jest.spyOn(pool, 'ensureRelay').mockResolvedValue(relay);
  const result = querySyncAbortable(
    pool,
    ['wss://inbox/'],
    { kinds: [1059] },
    { maxWait: 8000, ...params },
  );
  await jest.advanceTimersByTimeAsync(0);
  const sub = [...relay.openSubs.values()][0];
  const events = Array.from({ length: 30 }, (_, i) =>
    finalizeEvent({ kind: 1059, created_at: 1, tags: [], content: `wrap-${i}` }, key),
  );
  for (const event of events) relay._onmessage(message(['EVENT', sub.id, event]));
  return { relay, sub, events, result, verify };
}

it.each([false, true])(
  'drains all 30 pre-deadline inbox events and persistence before completion (wire EOSE: %s)',
  async (wireEose) => {
    let finishWrite!: () => void;
    jest
      .mocked(flushVerifiedEventCache)
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishWrite = resolve)));
    const { relay, sub, events, result, verify } = await inboxQuery();
    if (wireEose) relay._onmessage(message(['EOSE', sub.id]));
    const completed = jest.fn();
    void result.then(completed);
    await jest.advanceTimersByTimeAsync(8000);
    expect(verify.mock.calls.length).toBeGreaterThan(0);
    expect(verify.mock.calls.length).toBeLessThan(30);
    expect(completed).not.toHaveBeenCalled();
    // Traffic received after the deadline cannot extend the snapshot.
    relay._onmessage(
      message([
        'EVENT',
        sub.id,
        finalizeEvent({ kind: 1059, created_at: 1, tags: [], content: 'late' }, key),
      ]),
    );
    await jest.advanceTimersByTimeAsync(8000);
    expect(verify).toHaveBeenCalledTimes(30);
    expect(completed).not.toHaveBeenCalled();
    finishWrite();
    await jest.advanceTimersByTimeAsync(2000);
    expect((await result).map((event) => event.id)).toEqual(events.map((event) => event.id));
    expect(relay.openSubs.size).toBe(0);
    relay.close();
  },
);

it('explicit abort closes immediately even while deadline completion awaits the backlog', async () => {
  const controller = new AbortController();
  const { relay, result, verify } = await inboxQuery({ signal: controller.signal });
  await jest.advanceTimersByTimeAsync(8000);
  controller.abort();
  const partial = await result;
  expect(partial.length).toBeGreaterThan(0);
  expect(partial.length).toBeLessThan(30);
  expect(relay.openSubs.size).toBe(0);
  const verifiedAtAbort = verify.mock.calls.length;
  await jest.advanceTimersByTimeAsync(10_000);
  expect(verify).toHaveBeenCalledTimes(verifiedAtAbort);
  relay.close();
});

it('preserves strict timeout rejection after draining pre-deadline events', async () => {
  const { relay, result, verify } = await inboxQuery({ rejectOnTimeout: true });
  const assertion = expect(result).rejects.toThrow('Relay query timed out before EOSE');
  await jest.advanceTimersByTimeAsync(16_000);
  await assertion;
  expect(verify).toHaveBeenCalledTimes(30);
  expect(relay.openSubs.size).toBe(0);
  relay.close();
});
