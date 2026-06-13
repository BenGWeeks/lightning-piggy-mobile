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

// Cached immutable snapshot for `useSyncExternalStore`. Its identity is STABLE
// between writes — recomputed only when a write actually changes the map — so
// the subscribing hook doesn't see a "new" snapshot every render (which would
// loop infinitely). Rebuilt to a fresh object on every mutation (so its
// identity changes), then handed out unchanged until the next write.
let snapshot: Record<string, DeliveryStatus> = {};

function invalidateSnapshot(): void {
  snapshot = Object.fromEntries(statuses);
}

function emit(): void {
  for (const l of listeners) l();
}

// Cap on how many sent-message statuses we persist (#866). The store is one
// AsyncStorage JSON blob per account; without a bound it grows for the life of
// the install. A `Map` preserves insertion order, so the most-RECENT sends are
// the tail — we keep the last `MAX_PERSISTED_STATUSES` and drop the oldest.
// 500 covers far more than any thread renders at once while staying a small blob.
export const MAX_PERSISTED_STATUSES = 500;

// Snapshot the map for persistence, evicting the oldest entries past the cap.
// Insertion order (Map semantics) is the recency key — no Date.now(), so it's
// deterministic and test-stable. Returns a plain object for AsyncStorage.
function statusesForPersist(): Record<string, DeliveryStatus> {
  if (statuses.size <= MAX_PERSISTED_STATUSES) return Object.fromEntries(statuses);
  const entries = [...statuses.entries()];
  return Object.fromEntries(entries.slice(entries.length - MAX_PERSISTED_STATUSES));
}

function schedulePersist(): void {
  if (!persist) return;
  persist(statusesForPersist());
}

// Wire in the durable backing store (AsyncStorage in the app; a stub in tests).
// Called once on context init. Passing `null` detaches it (test teardown).
export function setDmDeliveryPersist(fn: Persist | null): void {
  persist = fn;
}

// Seed the in-memory map from persisted state. Starts from a CLEAN map: on an
// account switch the previous user's in-memory statuses MUST NOT survive into
// the new user's map, or a later persist writes the combined set under the new
// account's storage key (cross-account data mixing, #866). Does NOT emit —
// callers seed before any subscriber mounts; it also won't re-persist what it
// just read back.
export function hydrateDmDeliveryStore(persisted: Record<string, DeliveryStatus>): void {
  statuses.clear();
  for (const [eventId, status] of Object.entries(persisted)) {
    if (eventId) statuses.set(eventId, status);
  }
  invalidateSnapshot();
}

// Read a status by eventId. `undefined` = never tracked (legacy / received).
export function getDmDeliveryStatus(eventId: string | undefined): DeliveryStatus | undefined {
  if (!eventId) return undefined;
  return statuses.get(eventId);
}

// Stable snapshot of every tracked status — the `useSyncExternalStore`
// getSnapshot. Identity only changes when the map changed, so subscribers don't
// re-render in a loop.
export function getAllDmDeliveryStatuses(): Record<string, DeliveryStatus> {
  return snapshot;
}

// The capped view used for persistence (the teardown flush + debounced writes).
// Keeps the in-memory snapshot complete for rendering while bounding what hits
// AsyncStorage to the most-recent `MAX_PERSISTED_STATUSES` (#866).
export function getPersistableDmDeliveryStatuses(): Record<string, DeliveryStatus> {
  return statusesForPersist();
}

// Write/overwrite a status, notify subscribers, and persist. A settled status
// always wins over a pending one; a pending status never downgrades a settled
// one (a slow `pendingDelivery()` write can't clobber an already-resolved tick).
export function setDmDeliveryStatus(eventId: string, status: DeliveryStatus): void {
  if (!eventId) return;
  const existing = statuses.get(eventId);
  if (existing && !existing.pending && status.pending) return;
  // No-op if the status is referentially unchanged — avoids a needless emit +
  // persist (and a needless new snapshot identity) when nothing moved.
  if (existing === status) return;
  statuses.set(eventId, status);
  invalidateSnapshot();
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
  invalidateSnapshot();
}
