import { publishWrapsTrackingRelays, type RelayPublisher } from './nostrDmPublish';
import type { VerifiedEvent } from 'nostr-tools/pure';
import { summariseDelivery, type DeliveryStatus } from '../utils/dmDeliveryStatus';

// A fake wrap — only its identity matters to the pool stub.
const wrap = (id: string) => ({ id }) as unknown as VerifiedEvent;

// Deferred promise helper so a test can control exactly when a relay settles.
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('publishWrapsTrackingRelays — early-resolve + background settle (#857)', () => {
  it('resolves the send as soon as ONE relay accepts, not waiting for the slow one', async () => {
    const fast = deferred<string>();
    const slow = deferred<string>();
    const pool: RelayPublisher = {
      publish: () => [fast.promise, slow.promise],
    };
    const sendPromise = publishWrapsTrackingRelays(
      [wrap('w1')],
      ['wss://fast', 'wss://slow'],
      pool,
    );

    // Fast relay accepts; slow one is still in flight.
    fast.resolve('ok');
    const result = await sendPromise;

    // The send resolved without `slow` having settled — proves it didn't block.
    expect(result.wrapsPublished).toBe(1);
    expect(result.delivery.relayResults['wss://fast']).toBe('ok');
    // Clean up the dangling slow promise.
    slow.resolve('ok');
  });

  it('settles single → double: onFinalized fires with the complete breakdown', async () => {
    const fast = deferred<string>();
    const slow = deferred<string>();
    const pool: RelayPublisher = {
      publish: () => [fast.promise, slow.promise],
    };
    let finalized: DeliveryStatus | null = null;
    const sendPromise = publishWrapsTrackingRelays(
      [wrap('w1')],
      ['wss://fast', 'wss://slow'],
      pool,
      { eventId: 'rumor-1', kind: 14 },
      (d) => {
        finalized = d;
      },
    );

    fast.resolve('ok');
    const early = await sendPromise;
    // Early snapshot: only the fast relay landed → single tick (1 of 1 known).
    expect(summariseDelivery(early.delivery)).toEqual({ ok: 1, total: 1 });

    // Now the slow relay acks; the background finalize fires with BOTH relays.
    slow.resolve('ok');
    await new Promise((r) => setTimeout(r, 0));
    expect(finalized).not.toBeNull();
    expect(summariseDelivery(finalized as unknown as DeliveryStatus)).toEqual({ ok: 2, total: 2 });
    expect((finalized as unknown as DeliveryStatus).eventId).toBe('rumor-1');
  });

  it('records an all-failed send (every relay rejects) with delivered=false', async () => {
    const r1 = deferred<string>();
    const r2 = deferred<string>();
    const pool: RelayPublisher = { publish: () => [r1.promise, r2.promise] };
    const sendPromise = publishWrapsTrackingRelays([wrap('w1')], ['wss://a', 'wss://b'], pool);
    r1.reject(new Error('relay a down'));
    r2.reject(new Error('relay b down'));
    const result = await sendPromise;
    expect(result.wrapsPublished).toBe(0);
    expect(result.delivery.delivered).toBe(false);
    expect(result.errors[0]).toContain('relay a down');
  });

  it('carries the rumor eventId + kind onto the delivery status', async () => {
    const ok = deferred<string>();
    const pool: RelayPublisher = { publish: () => [ok.promise] };
    const sendPromise = publishWrapsTrackingRelays([wrap('w1')], ['wss://a'], pool, {
      eventId: 'abc',
      kind: 14,
    });
    ok.resolve('ok');
    const result = await sendPromise;
    expect(result.delivery.eventId).toBe('abc');
    expect(result.delivery.kind).toBe(14);
  });
});
