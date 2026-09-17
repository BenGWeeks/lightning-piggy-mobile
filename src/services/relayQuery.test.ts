import { querySyncAbortable } from './relayQuery';
import type { SimplePool } from 'nostr-tools/pool';
import type { Event as NostrEvent } from 'nostr-tools/pure';

type SubParams = {
  maxWait?: number;
  abort?: AbortSignal;
  onevent: (e: NostrEvent) => void;
  oneose: () => void;
  onclose: (reasons: string[]) => void;
};

const makeEvent = (id: string): NostrEvent =>
  ({ id, kind: 1, pubkey: 'p', created_at: 0, tags: [], content: '', sig: 's' }) as NostrEvent;

/** Fake pool whose subscribeMany hands the caller the registered handlers so a
 *  test can drive onevent / oneose / abort deterministically. */
function fakePool(): { pool: SimplePool; params: () => SubParams; close: jest.Mock } {
  let captured: SubParams | undefined;
  const close = jest.fn();
  const pool = {
    subscribeMany: (_relays: string[], _filter: unknown, params: SubParams) => {
      captured = params;
      return { close };
    },
  } as unknown as SimplePool;
  return {
    pool,
    params: () => {
      if (!captured) throw new Error('subscribeMany was not called');
      return captured;
    },
    close,
  };
}

describe('querySyncAbortable', () => {
  it('collects events and resolves on EOSE, closing the sub', async () => {
    const { pool, params, close } = fakePool();
    const promise = querySyncAbortable(pool, ['wss://r'], { kinds: [1] }, { maxWait: 1000 });
    params().onevent(makeEvent('a'));
    params().onevent(makeEvent('b'));
    params().oneose();
    const events = await promise;
    expect(events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('resolves with partial results and closes the sub when the signal aborts', async () => {
    const { pool, params, close } = fakePool();
    const ctrl = new AbortController();
    const promise = querySyncAbortable(pool, ['wss://r'], { kinds: [1] }, { signal: ctrl.signal });
    params().onevent(makeEvent('a'));
    ctrl.abort();
    const events = await promise;
    expect(events.map((e) => e.id)).toEqual(['a']);
    expect(close).toHaveBeenCalled();
  });

  it('resolves empty immediately without subscribing if the signal is already aborted', async () => {
    const subscribeMany = jest.fn();
    const pool = { subscribeMany } as unknown as SimplePool;
    const ctrl = new AbortController();
    ctrl.abort();
    const events = await querySyncAbortable(
      pool,
      ['wss://r'],
      { kinds: [1] },
      { signal: ctrl.signal },
    );
    expect(events).toEqual([]);
    expect(subscribeMany).not.toHaveBeenCalled();
  });

  it('settles only once even if EOSE fires after an abort', async () => {
    const { pool, params, close } = fakePool();
    const ctrl = new AbortController();
    const promise = querySyncAbortable(pool, ['wss://r'], { kinds: [1] }, { signal: ctrl.signal });
    ctrl.abort();
    // A late EOSE from the relay must not throw or re-resolve.
    params().oneose();
    await promise;
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('querySyncAbortable de-duplication', () => {
  it('keeps one copy of an event id even if it arrives from several relays', async () => {
    const { pool, params } = fakePool();
    const promise = querySyncAbortable(pool, ['wss://a', 'wss://b'], { kinds: [1] }, {});
    params().onevent(makeEvent('a'));
    params().onevent(makeEvent('a'));
    params().onevent(makeEvent('b'));
    params().oneose();
    expect((await promise).map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('querySyncAbortable deadline', () => {
  afterEach(() => jest.useRealTimers());

  it('rejects at the deadline when nothing was received and rejectOnAllRelaysFailure is set', async () => {
    jest.useFakeTimers();
    const { pool, params, close } = fakePool();
    const promise = querySyncAbortable(
      pool,
      ['wss://a'],
      { kinds: [1] },
      { maxWait: 1000, rejectOnAllRelaysFailure: true },
    );
    expect(params().maxWait).toBe(2000); // pool's own timeout trails ours
    jest.advanceTimersByTime(1000);
    await expect(promise).rejects.toThrow('timed out');
    expect(close).toHaveBeenCalled();
  });

  it('resolves partial results at the deadline, and [] without the flag', async () => {
    jest.useFakeTimers();
    const a = fakePool();
    const withEvents = querySyncAbortable(a.pool, ['wss://a'], { kinds: [1] }, { maxWait: 1000, rejectOnAllRelaysFailure: true }); // prettier-ignore
    a.params().onevent(makeEvent('x'));
    const b = fakePool();
    const noFlag = querySyncAbortable(b.pool, ['wss://a'], { kinds: [1] }, { maxWait: 1000 });
    jest.advanceTimersByTime(1000);
    expect((await withEvents).map((e) => e.id)).toEqual(['x']);
    expect(await noFlag).toEqual([]);
  });
});

describe('scoped aggregate connection failures', () => {
  it('rejects when every relay dropped the socket after connecting ("relay connection closed")', async () => {
    const { pool, params } = fakePool();
    const promise = querySyncAbortable(
      pool,
      ['wss://a', 'wss://b'],
      { kinds: [1] },
      { rejectOnAllRelaysFailure: true },
    );
    params().oneose();
    params().onclose(['relay connection closed', 'websocket closed']);
    await expect(promise).rejects.toThrow('All relays failed');
  });

  it('treats relay refusals (NIP-42 auth failure, auth-required / restricted CLOSED) as failures', async () => {
    const { pool, params } = fakePool();
    const promise = querySyncAbortable(
      pool,
      ['wss://a', 'wss://b', 'wss://c'],
      { kinds: [1] },
      { rejectOnAllRelaysFailure: true },
    );
    params().oneose();
    params().onclose([
      'auth was required and attempted, but failed with: bad sig',
      'auth-required: we only serve subscriptions to registered users',
      'restricted: not allowed',
    ]);
    await expect(promise).rejects.toThrow('All relays failed');
  });

  it('accepts every nostr-tools timeout reason, prefixed or not', async () => {
    const { pool, params } = fakePool();
    const promise = querySyncAbortable(
      pool,
      ['wss://a', 'wss://b', 'wss://c'],
      { kinds: [1] },
      { rejectOnAllRelaysFailure: true },
    );
    params().oneose();
    params().onclose(['connection timed out', 'relay connection timed out', 'auth timed out']);
    await expect(promise).rejects.toThrow('All relays failed');
  });

  it('does not treat a deliberate close as a failure', async () => {
    const { pool, params } = fakePool();
    const promise = querySyncAbortable(
      pool,
      ['wss://a'],
      { kinds: [1] },
      {
        rejectOnAllRelaysFailure: true,
      },
    );
    params().oneose();
    params().onclose(['closed by caller']);
    await expect(promise).resolves.toEqual([]);
  });

  it('rejects all-relay connection failure even when EOSE fires first', async () => {
    const { pool, params } = fakePool();
    const result = querySyncAbortable(
      pool,
      ['wss://a', 'wss://b'],
      {},
      { rejectOnAllRelaysFailure: true },
    );
    params().oneose();
    params().onclose(['connection failed', 'connection timed out']);
    await expect(result).rejects.toThrow('All relays failed');
  });
  it('preserves default resolution on connection failure', async () => {
    const { pool, params } = fakePool();
    const result = querySyncAbortable(pool, ['wss://a'], {}, {});
    params().oneose();
    params().onclose(['connection failed']);
    await expect(result).resolves.toEqual([]);
  });
  it('preserves partial results despite a failure close', async () => {
    const { pool, params } = fakePool();
    const result = querySyncAbortable(pool, ['wss://a'], {}, { rejectOnAllRelaysFailure: true });
    params().onevent(makeEvent('a'));
    params().oneose();
    params().onclose(['connection failed']);
    await expect(result).resolves.toHaveLength(1);
  });
  it('resolves on EOSE or subscription timeout without a connection failure', async () => {
    const { pool, params } = fakePool();
    const result = querySyncAbortable(
      pool,
      ['wss://a'],
      {},
      { rejectOnAllRelaysFailure: true, maxWait: 1 },
    );
    params().oneose(); // The pool uses this callback for eoseTimeout too.
    await expect(result).resolves.toEqual([]);
  });
  it('abort remains successful even if connection failures subsequently arrive', async () => {
    const { pool, params } = fakePool();
    const controller = new AbortController();
    const result = querySyncAbortable(
      pool,
      ['wss://a'],
      {},
      { rejectOnAllRelaysFailure: true, signal: controller.signal },
    );
    controller.abort();
    params().onclose(['connection failed']);
    await expect(result).resolves.toEqual([]);
  });
});
