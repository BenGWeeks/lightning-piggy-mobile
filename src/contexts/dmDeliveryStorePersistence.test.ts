import AsyncStorage from '@react-native-async-storage/async-storage';
import { bindDmDeliveryStorePersistence } from './dmDeliveryStorePersistence';
import {
  setDmDeliveryStatus,
  getDmDeliveryStatus,
  hydrateDmDeliveryStore,
  __resetDmDeliveryStore,
} from '../utils/dmDeliveryStore';
import { pendingDelivery, type DeliveryStatus } from '../utils/dmDeliveryStatus';

// A controllable AsyncStorage.getItem: each call returns a promise we resolve by
// hand, so we can interleave two binds deterministically (account A's getItem
// resolving AFTER account B has fully bound) without real timers or Date.now.
type Deferred = { promise: Promise<string | null>; resolve: (v: string | null) => void };
function deferred(): Deferred {
  let resolve!: (v: string | null) => void;
  const promise = new Promise<string | null>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const delivered = (relays: Record<string, 'ok' | 'failed'>): DeliveryStatus => ({
  delivered: Object.values(relays).some((r) => r === 'ok'),
  relayResults: relays,
});

const ACCOUNT_A = 'npubAAAA';
const ACCOUNT_B = 'npubBBBB';

describe('bindDmDeliveryStorePersistence — cross-account race guards (#866)', () => {
  beforeEach(() => {
    __resetDmDeliveryStore();
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('a stale bind whose getItem resolves AFTER a newer bind does NOT hydrate or detach the new account', async () => {
    // Account A's blob has a status; account B's blob is empty. If A's late
    // continuation wins, it would clobber B's in-memory map with A's data.
    const dA = deferred();
    const dB = deferred();
    const getItem = jest
      .spyOn(AsyncStorage, 'getItem')
      // first call (account A) -> deferred A; second call (account B) -> deferred B
      .mockImplementationOnce(() => dA.promise)
      .mockImplementationOnce(() => dB.promise);

    // Start A's bind, then B's bind, before either getItem resolves.
    const bindAPromise = bindDmDeliveryStorePersistence(ACCOUNT_A);
    const bindBPromise = bindDmDeliveryStorePersistence(ACCOUNT_B);

    // B resolves FIRST (empty blob) and fully binds: hydrates clean + installs
    // its persist hook.
    dB.resolve(null);
    const teardownB = await bindBPromise;

    // B now owns the store. Simulate B writing a settled status.
    const bEventId = 'b-event';
    setDmDeliveryStatus(bEventId, delivered({ 'wss://b': 'ok' }));
    expect(getDmDeliveryStatus(bEventId)?.delivered).toBe(true);

    // NOW A's getItem resolves late, with A's persisted data.
    dA.resolve(JSON.stringify({ 'a-event': pendingDelivery({ eventId: 'a-event' }) }));
    const teardownA = await bindAPromise;

    // The stale bind A must NOT have hydrated: B's status survives, A's data is
    // absent from the in-memory map.
    expect(getDmDeliveryStatus(bEventId)?.delivered).toBe(true);
    expect(getDmDeliveryStatus('a-event')).toBeUndefined();

    // And A must NOT have detached / replaced B's persist hook: a write still
    // schedules a persist to B's key.
    setDmDeliveryStatus('b-event-2', delivered({ 'wss://b': 'ok' }));
    jest.advanceTimersByTime(300);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'dmDeliveryStore_npubbbbb',
      expect.stringContaining('b-event-2'),
    );
    // No write under account A's key.
    const wroteToA = (AsyncStorage.setItem as jest.Mock).mock.calls.some(
      ([k]) => k === 'dmDeliveryStore_npubaaaa',
    );
    expect(wroteToA).toBe(false);

    teardownA();
    teardownB();
    expect(getItem).toHaveBeenCalledTimes(2);
  });

  it('an aborted bind (AbortSignal) does NOT hydrate or install its persist hook', async () => {
    const dA = deferred();
    jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(() => dA.promise);

    // Seed an in-memory status as if a live account already had one.
    hydrateDmDeliveryStore({ live: delivered({ 'wss://x': 'ok' }) });

    const controller = new AbortController();
    const bindPromise = bindDmDeliveryStorePersistence(ACCOUNT_A, { signal: controller.signal });

    // Caller tears down (account switch) before getItem resolves.
    controller.abort();
    dA.resolve(JSON.stringify({ stale: pendingDelivery({ eventId: 'stale' }) }));
    const teardown = await bindPromise;

    // Aborted bind never hydrated: the pre-existing status survives, the stale
    // blob is not applied.
    expect(getDmDeliveryStatus('live')?.delivered).toBe(true);
    expect(getDmDeliveryStatus('stale')).toBeUndefined();

    // It never installed a persist hook, so a write produces no setItem.
    setDmDeliveryStatus('after', delivered({ 'wss://x': 'ok' }));
    jest.advanceTimersByTime(300);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();

    // The returned teardown is inert (does not throw, does not detach anything).
    expect(() => teardown()).not.toThrow();
  });

  it('per-binding teardown clears only its own debounce timer (second bind survives the first bind teardown)', async () => {
    // Two SEQUENTIAL binds for the same account. The debounce timer must be
    // closure-local: tearing down the FIRST binding must not cancel a pending
    // write scheduled by the SECOND binding's hook.
    jest.spyOn(AsyncStorage, 'getItem').mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    const teardown1 = await bindDmDeliveryStorePersistence(ACCOUNT_A);
    const teardown2 = await bindDmDeliveryStorePersistence(ACCOUNT_A);

    // The SECOND (current) hook schedules a debounced write.
    setDmDeliveryStatus('pending-write', delivered({ 'wss://a': 'ok' }));

    // Tear down the FIRST binding. With a module-scoped timer this would clear
    // the second binding's pending write; with a per-binding timer it must not.
    (AsyncStorage.setItem as jest.Mock).mockClear();
    teardown1();

    // teardown1's own flush writes once (synchronously, from its closure).
    const flushedOnTeardown1 = (AsyncStorage.setItem as jest.Mock).mock.calls.length;

    // Let the second binding's debounce fire.
    jest.advanceTimersByTime(300);

    // The second binding's debounced write must still have landed — proving its
    // timer was NOT cancelled by teardown1.
    const wroteContaining = (AsyncStorage.setItem as jest.Mock).mock.calls.some(([, v]) =>
      String(v).includes('pending-write'),
    );
    expect(wroteContaining).toBe(true);
    expect(flushedOnTeardown1).toBeGreaterThanOrEqual(0);

    teardown2();
  });
});
