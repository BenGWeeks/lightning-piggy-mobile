import {
  setDmDeliveryStatus,
  getDmDeliveryStatus,
  getAllDmDeliveryStatuses,
  subscribeDmDelivery,
  hydrateDmDeliveryStore,
  setDmDeliveryPersist,
  __resetDmDeliveryStore,
} from './dmDeliveryStore';
import { pendingDelivery, failedDelivery, type DeliveryStatus } from './dmDeliveryStatus';

const delivered = (relays: Record<string, 'ok' | 'failed'>): DeliveryStatus => ({
  delivered: Object.values(relays).some((r) => r === 'ok'),
  relayResults: relays,
});

describe('dmDeliveryStore — eventId-keyed delivery store (#857)', () => {
  afterEach(() => __resetDmDeliveryStore());

  it('stores and reads a status by eventId, surviving the local→echo id swap', () => {
    // The crux: the optimistic row starts as `local-...` then becomes the echo
    // id, but the STATUS is keyed by the stable rumor eventId throughout — so a
    // read by that eventId works regardless of which row id is on screen.
    const eventId = 'rumor-event-id';
    setDmDeliveryStatus(eventId, pendingDelivery({ eventId }));
    expect(getDmDeliveryStatus(eventId)?.pending).toBe(true);
    setDmDeliveryStatus(eventId, delivered({ 'wss://a': 'ok', 'wss://b': 'ok' }));
    expect(getDmDeliveryStatus(eventId)?.pending).toBeFalsy();
    expect(getDmDeliveryStatus(eventId)?.delivered).toBe(true);
  });

  it('returns undefined for an untracked / received message', () => {
    expect(getDmDeliveryStatus('never-sent')).toBeUndefined();
    expect(getDmDeliveryStatus(undefined)).toBeUndefined();
  });

  it('does NOT downgrade a settled status with a late pending write', () => {
    // The 10s echo re-fetch (or a retry race) must never re-stamp a settled
    // tick back to a clock. A settled status wins over a later pending one.
    const eventId = 'e1';
    setDmDeliveryStatus(eventId, delivered({ 'wss://a': 'ok' }));
    setDmDeliveryStatus(eventId, pendingDelivery({ eventId }));
    expect(getDmDeliveryStatus(eventId)?.pending).toBeFalsy();
    expect(getDmDeliveryStatus(eventId)?.delivered).toBe(true);
  });

  it('lets a settled status override an earlier pending one', () => {
    const eventId = 'e2';
    setDmDeliveryStatus(eventId, pendingDelivery({ eventId }));
    setDmDeliveryStatus(eventId, failedDelivery({ eventId }));
    expect(getDmDeliveryStatus(eventId)?.pending).toBeFalsy();
    expect(getDmDeliveryStatus(eventId)?.delivered).toBe(false);
  });

  it('notifies subscribers on write and stops after unsubscribe', () => {
    const seen: number[] = [];
    const unsub = subscribeDmDelivery(() => seen.push(1));
    setDmDeliveryStatus('e3', pendingDelivery());
    setDmDeliveryStatus('e3', delivered({ 'wss://a': 'ok' }));
    expect(seen).toHaveLength(2);
    unsub();
    setDmDeliveryStatus('e3', delivered({ 'wss://a': 'ok', 'wss://b': 'ok' }));
    expect(seen).toHaveLength(2);
  });

  it('hydrates from a persisted snapshot without re-persisting it', () => {
    const persist = jest.fn();
    setDmDeliveryPersist(persist);
    hydrateDmDeliveryStore({ e4: delivered({ 'wss://a': 'ok' }) });
    expect(getDmDeliveryStatus('e4')?.delivered).toBe(true);
    // Hydration must not trigger a persist write (it just read it back).
    expect(persist).not.toHaveBeenCalled();
  });

  it('persists the full map on every settle so a cold restart can rehydrate', () => {
    const persist = jest.fn();
    setDmDeliveryPersist(persist);
    setDmDeliveryStatus('e5', pendingDelivery({ eventId: 'e5' }));
    setDmDeliveryStatus('e5', delivered({ 'wss://a': 'ok' }));
    expect(persist).toHaveBeenCalledTimes(2);
    // The last call carries the settled snapshot — what a cold restart reads.
    const last = persist.mock.calls[persist.mock.calls.length - 1][0];
    expect(last.e5.delivered).toBe(true);
  });

  it('snapshots the whole map for the render-time resolver', () => {
    setDmDeliveryStatus('a', delivered({ 'wss://x': 'ok' }));
    setDmDeliveryStatus('b', failedDelivery({ eventId: 'b' }));
    const all = getAllDmDeliveryStatuses();
    expect(Object.keys(all).sort()).toEqual(['a', 'b']);
  });

  it('ignores writes with an empty eventId', () => {
    setDmDeliveryStatus('', delivered({ 'wss://a': 'ok' }));
    expect(getAllDmDeliveryStatuses()).toEqual({});
  });
});
