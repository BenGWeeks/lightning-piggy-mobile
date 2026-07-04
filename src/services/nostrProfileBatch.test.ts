/**
 * `fetchProfilesBatch` early-resolve (#852).
 *
 * The pull-to-refresh hang was dominated by this batch idling out its full
 * soft-timeout even once every requested kind-0 had already arrived. With a
 * 571-contact follow list that stacked up to ~90s of dead waiting. These
 * tests pin the fix: the batch resolves the instant all wanted pubkeys have
 * produced a kind-0, and the soft-timeout survives only as a fallback for
 * pubkeys that never answer.
 */

import { fetchProfilesBatch } from './nostrProfileBatch';
import { pool } from './nostrService';

type OnEvent = (ev: { pubkey: string; content: string; created_at: number }) => void;

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);
const RELAYS = ['wss://relay.example'];
const SOFT_TIMEOUT = 10000;

/**
 * Install a fake `pool.subscribeMany` that captures the `onevent` handler so
 * the test can drive kind-0 arrivals synchronously, and hands back a spyable
 * `close()`.
 */
function mockSubscribeMany() {
  const close = jest.fn();
  let captured: OnEvent | null = null;
  const spy = jest.spyOn(pool, 'subscribeMany').mockImplementation(((
    _relays: string[],
    _filter: unknown,
    handlers: { onevent?: OnEvent },
  ) => {
    captured = handlers.onevent ?? null;
    return { close };
  }) as unknown as typeof pool.subscribeMany);
  return {
    close,
    spy,
    emit: (pubkey: string, created_at = 1700000000) =>
      captured?.({ pubkey, content: '{}', created_at }),
  };
}

describe('fetchProfilesBatch early-resolve (#852)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('resolves as soon as every requested pubkey has produced a kind-0 — without idling out the soft-timeout', async () => {
    const m = mockSubscribeMany();
    const onEvent = jest.fn();

    const promise = fetchProfilesBatch([PK_A, PK_B], RELAYS, SOFT_TIMEOUT, onEvent);

    // Both profiles land well before the soft-timeout fires.
    m.emit(PK_A);
    m.emit(PK_B);

    // Resolves via the early-exit path — note we never advanced timers.
    await expect(promise).resolves.toBeUndefined();
    expect(m.close).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it('does NOT early-resolve while a requested pubkey is still missing; falls back to the soft-timeout', async () => {
    const m = mockSubscribeMany();
    const promise = fetchProfilesBatch([PK_A, PK_B], RELAYS, SOFT_TIMEOUT, jest.fn());

    // Only one of the two answers — not enough to short-circuit.
    m.emit(PK_A);

    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(m.close).not.toHaveBeenCalled();

    // The soft-timeout backstop still closes the sub and resolves.
    jest.advanceTimersByTime(SOFT_TIMEOUT);
    await expect(promise).resolves.toBeUndefined();
    expect(m.close).toHaveBeenCalledTimes(1);
  });

  it('counts unique pubkeys — duplicate/older kind-0s for one contact do not satisfy the whole batch', async () => {
    const m = mockSubscribeMany();
    const onEvent = jest.fn();
    const promise = fetchProfilesBatch([PK_A, PK_B], RELAYS, SOFT_TIMEOUT, onEvent);

    // Same pubkey twice (newer then older): only one unique seen → 1 of 2.
    m.emit(PK_A, 1700000002);
    m.emit(PK_A, 1700000001); // older — ignored by the newest-wins guard

    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    // Only the newer of the two duplicates was forwarded.
    expect(onEvent).toHaveBeenCalledTimes(1);

    // The second distinct pubkey completes the set → early-resolve.
    m.emit(PK_B);
    await expect(promise).resolves.toBeUndefined();
    expect(m.close).toHaveBeenCalledTimes(1);
  });

  it('resolves immediately for an empty pubkey list (no sub opened)', async () => {
    const m = mockSubscribeMany();
    await expect(fetchProfilesBatch([], RELAYS, SOFT_TIMEOUT, jest.fn())).resolves.toBeUndefined();
    expect(m.spy).not.toHaveBeenCalled();
  });
});
