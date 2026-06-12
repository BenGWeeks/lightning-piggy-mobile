import type { DeliveryStatus } from './dmDeliveryStatus';

// Delivery-status store for SENT NIP-17 DMs, keyed by the rumor `eventId`
// (#857). The eventId is the stable inner kind-14/15 event id, computed at
// send time and identical on the relay echo — so a status keyed by it survives
// the optimistic `local-` → real-id row swap AND the ~10s echo re-fetch that
// previously stripped the tick (the merge/reconcile lost it in a text+window
// race). The conversation screen resolves each sent bubble's status from this
// store by eventId, independent of which row id is currently in the list.
//
// Lifecycle of one send:
//   1. set(eventId, pendingDelivery())  → bubble paints a Clock immediately.
//   2. set(eventId, <settled>)          → publish resolves: green single/double
//                                          or red failed.
// Persistence (injected) keeps the settled status across a cold restart so the
// re-rendered echo (id === eventId) reads its tick back.

type Persist = (statuses: Record<string, DeliveryStatus>) => void;

type Listener = () => void;

// The single shared map: rumor eventId → its latest DeliveryStatus.
const statuses = new Map<string, DeliveryStatus>();
const listeners = new Set<Listener>();
let persist: Persist | null = null;

function emit(): void {
  for (const l of listeners) l();
}

function schedulePersist(): void {
  if (!persist) return;
  persist(Object.fromEntries(statuses));
}

// Wire in the durable backing store (AsyncStorage in the app; a stub in tests).
// Called once on context init. Passing `null` detaches it (test teardown).
export function setDmDeliveryPersist(fn: Persist | null): void {
  persist = fn;
}

// Seed the in-memory map from persisted state on cold start. Does NOT emit —
// callers seed before any subscriber mounts; it also won't re-persist what it
// just read back.
export function hydrateDmDeliveryStore(persisted: Record<string, DeliveryStatus>): void {
  for (const [eventId, status] of Object.entries(persisted)) {
    if (eventId) statuses.set(eventId, status);
  }
}

// Read a status by eventId. `undefined` = never tracked (legacy / received).
export function getDmDeliveryStatus(eventId: string | undefined): DeliveryStatus | undefined {
  if (!eventId) return undefined;
  return statuses.get(eventId);
}

// Snapshot of every tracked status — used to seed a render pass and by tests.
export function getAllDmDeliveryStatuses(): Record<string, DeliveryStatus> {
  return Object.fromEntries(statuses);
}

// Write/overwrite a status, notify subscribers, and persist. A settled status
// always wins over a pending one; a pending status never downgrades a settled
// one (a slow `pendingDelivery()` write can't clobber an already-resolved tick).
export function setDmDeliveryStatus(eventId: string, status: DeliveryStatus): void {
  if (!eventId) return;
  const existing = statuses.get(eventId);
  if (existing && !existing.pending && status.pending) return;
  statuses.set(eventId, status);
  emit();
  schedulePersist();
}

// Subscribe to any change; returns an unsubscribe. The conversation screen uses
// this to re-render sent bubbles as their status settles.
export function subscribeDmDelivery(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Test-only: wipe the map + listeners + persist hook so each test starts clean.
export function __resetDmDeliveryStore(): void {
  statuses.clear();
  listeners.clear();
  persist = null;
}
