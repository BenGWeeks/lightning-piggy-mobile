import { __resetMentionProfilesForTests, subscribeMentionProfile } from './nostrMentionProfiles';
import { querySyncAbortable } from './relayQuery';
import * as storage from './zapSenderProfileStorage';

jest.mock('./nostrPool', () => ({ pool: {}, trackRelays: jest.fn() }));
jest.mock('./relayQuery', () => ({ querySyncAbortable: jest.fn() }));
jest.mock('./zapSenderProfileStorage', () => ({
  peekSync: jest.fn(() => null),
  getMany: jest.fn(async () => new Map()),
  setMany: jest.fn(),
}));
const query = jest.mocked(querySyncAbortable);
const relays = Array.from({ length: 10 }, (_, i) => `wss://relay-${i}`);
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  __resetMentionProfilesForTests();
  query.mockResolvedValue([]);
});
afterEach(() => {
  __resetMentionProfilesForTests();
  jest.useRealTimers();
});

it('batches 200 distinct mentions, caps filters and relays, and deduplicates repeated pubkeys', async () => {
  const receivers = Array.from({ length: 200 }, () => jest.fn());
  receivers.forEach((receive, i) => subscribeMentionProfile(`${i}`, relays, receive));
  subscribeMentionProfile('0', relays, jest.fn());
  await jest.advanceTimersByTimeAsync(300);
  expect(query).toHaveBeenCalledTimes(4);
  expect(query.mock.calls.flatMap(([, , filter]) => filter.authors)).toHaveLength(200);
  for (const [, urls, filter, opts] of query.mock.calls) {
    expect(urls).toHaveLength(6);
    expect(filter.authors!.length).toBeLessThanOrEqual(64);
    expect(filter.limit).toBe(filter.authors!.length * 2);
    expect(opts.signal?.aborted).toBe(false);
  }
  receivers.forEach((receive) => expect(receive).toHaveBeenCalledTimes(1));
});

it('cancels queued work on blur and aborts an active batch only after its last owner leaves', async () => {
  const cancel = subscribeMentionProfile('queued', relays, jest.fn());
  cancel();
  await jest.advanceTimersByTimeAsync(60);
  expect(query).not.toHaveBeenCalled();
  let finish!: (events: never[]) => void;
  query.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const receive = jest.fn();
  const a = subscribeMentionProfile('a', relays, receive);
  const b = subscribeMentionProfile('b', relays, receive);
  await jest.advanceTimersByTimeAsync(60);
  const signal = query.mock.calls[0][3].signal!;
  a();
  expect(signal.aborted).toBe(false);
  b();
  expect(signal.aborted).toBe(true);
  finish([]);
  await jest.advanceTimersByTimeAsync(60);
  expect(receive).not.toHaveBeenCalled();
});

it('uses only matching cosmetic metadata and never persists unverified payment fields', async () => {
  query.mockResolvedValue([
    {
      kind: 0,
      pubkey: 'a',
      created_at: 1,
      content: JSON.stringify({ name: 'Alice', picture: 'avatar', lud16: 'forged@payment' }),
    },
    { kind: 0, pubkey: 'stranger', created_at: 2, content: '{"name":"Unsolicited"}' },
  ] as never);
  const receive = jest.fn();
  subscribeMentionProfile('a', relays, receive);
  await jest.advanceTimersByTimeAsync(60);
  expect(receive).toHaveBeenCalledWith({ name: 'Alice', picture: 'avatar' });
  expect(storage.setMany).not.toHaveBeenCalled();
  subscribeMentionProfile('a', relays, receive);
  await jest.advanceTimersByTimeAsync(60);
  expect(query).toHaveBeenCalledTimes(1);
});

it('requeues a returning owner skipped during disk lookup without delivering or caching a miss', async () => {
  let finishDisk!: (profiles: Map<string, never>) => void;
  let finishQuery!: (events: never[]) => void;
  jest.mocked(storage.getMany).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishDisk = resolve;
      }),
  );
  query.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishQuery = resolve;
      }),
  );
  const receiveA = jest.fn();
  const receiveB = jest.fn();
  subscribeMentionProfile('a', relays, receiveA);
  const blurB = subscribeMentionProfile('b', relays, receiveB);
  await jest.advanceTimersByTimeAsync(60);
  blurB();
  finishDisk(new Map<string, never>());
  await jest.advanceTimersByTimeAsync(0);
  expect(query.mock.calls[0][2].authors).toEqual(['a']);
  subscribeMentionProfile('b', relays, receiveB);
  finishQuery([]);
  await jest.advanceTimersByTimeAsync(0);
  expect(receiveA).toHaveBeenCalledTimes(1);
  expect(receiveB).not.toHaveBeenCalled();
  query.mockResolvedValue([
    { kind: 0, pubkey: 'b', created_at: 1, content: '{"name":"Bob"}' },
  ] as never);
  await jest.advanceTimersByTimeAsync(60);
  expect(query.mock.calls[1][2].authors).toEqual(['b']);
  expect(receiveB).toHaveBeenCalledTimes(1);
  expect(receiveB).toHaveBeenCalledWith({ name: 'Bob', picture: null });
});
