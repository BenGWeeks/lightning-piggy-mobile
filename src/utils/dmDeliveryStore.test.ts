import {
  setDmDeliveryStatus,
  getDmDeliveryStatus,
  getAllDmDeliveryStatuses,
  getPersistableDmDeliveryStatuses,
  subscribeDmDelivery,
  hydrateDmDeliveryStore,
  setDmDeliveryPersist,
  MAX_PERSISTED_STATUSES,
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

  it('clears the previous map on hydrate so accounts cannot mix (#866)', () => {
    // Account A's send lands in the in-memory map.
    setDmDeliveryStatus('accountA-event', delivered({ 'wss://a': 'ok' }));
    expect(getDmDeliveryStatus('accountA-event')?.delivered).toBe(true);
    // Switching to account B hydrates with B's blob — A's status must be GONE,
    // or a later persist would write the combined set under B's storage key.
    hydrateDmDeliveryStore({ 'accountB-event': delivered({ 'wss://b': 'ok' }) });
    expect(getDmDeliveryStatus('accountA-event')).toBeUndefined();
    expect(getDmDeliveryStatus('accountB-event')?.delivered).toBe(true);
    expect(Object.keys(getAllDmDeliveryStatuses())).toEqual(['accountB-event']);
  });

  it('hydrating with an empty map fully clears in-memory statuses (#866)', () => {
    setDmDeliveryStatus('stale', delivered({ 'wss://a': 'ok' }));
    hydrateDmDeliveryStore({});
    expect(getAllDmDeliveryStatuses()).toEqual({});
  });

  it('caps the persisted map at MAX_PERSISTED_STATUSES, keeping the most recent (#866)', () => {
    const persist = jest.fn();
    setDmDeliveryPersist(persist);
    const total = MAX_PERSISTED_STATUSES + 50;
    for (let i = 0; i < total; i++) {
      setDmDeliveryStatus(`e${i}`, delivered({ 'wss://a': 'ok' }));
    }
    const persisted = getPersistableDmDeliveryStatuses();
    const keys = Object.keys(persisted);
    expect(keys).toHaveLength(MAX_PERSISTED_STATUSES);
    // The oldest 50 are evicted; the newest are kept (insertion-order recency).
    expect(persisted['e0']).toBeUndefined();
    expect(persisted[`e${total - 1}`]).toBeDefined();
    expect(persisted[`e${total - MAX_PERSISTED_STATUSES}`]).toBeDefined();
    expect(persisted[`e${total - MAX_PERSISTED_STATUSES - 1}`]).toBeUndefined();
    // The last debounced persist payload is also capped.
    const lastPayload = persist.mock.calls[persist.mock.calls.length - 1][0];
    expect(Object.keys(lastPayload)).toHaveLength(MAX_PERSISTED_STATUSES);
  });

  it('does not cap the in-memory snapshot used for rendering (#866)', () => {
    // Only the persisted blob is bounded; the live snapshot keeps everything so
    // an on-screen bubble older than the cap still resolves its tick.
    for (let i = 0; i < MAX_PERSISTED_STATUSES + 10; i++) {
      setDmDeliveryStatus(`r${i}`, delivered({ 'wss://a': 'ok' }));
    }
    expect(Object.keys(getAllDmDeliveryStatuses())).toHaveLength(MAX_PERSISTED_STATUSES + 10);
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

  it('keeps a STABLE snapshot identity between reads (no useSyncExternalStore loop)', () => {
    // Regression: getSnapshot must return the same reference until the map
    // actually changes, or useSyncExternalStore re-renders infinitely.
    const status = delivered({ 'wss://a': 'ok' });
    setDmDeliveryStatus('e6', status);
    const snap1 = getAllDmDeliveryStatuses();
    const snap2 = getAllDmDeliveryStatuses();
    expect(snap1).toBe(snap2);
    // A no-op write (same status reference) must not mint a new snapshot.
    setDmDeliveryStatus('e6', status);
    expect(getAllDmDeliveryStatuses()).toBe(snap1);
    // A real change mints a fresh snapshot.
    setDmDeliveryStatus('e6', delivered({ 'wss://a': 'ok', 'wss://b': 'ok' }));
    expect(getAllDmDeliveryStatuses()).not.toBe(snap1);
  });
});
