import { querySyncAbortable } from '../../src/services/relayQuery';
import type { SimplePool } from 'nostr-tools/pool';
import type { Event as NostrEvent } from 'nostr-tools/pure';

type SubParams = {
  maxWait?: number;
  abort?: AbortSignal;
  onevent: (e: NostrEvent) => void;
  oneose: () => void;
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
