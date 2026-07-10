import type { DmInboxEntry } from '../utils/conversationSummaries';

// Follow-gate deferral buffer for the live NIP-17 / NIP-04 sub (#851 F2).
//
// Immediately after an account switch the contacts list hydrates
// asynchronously (`setContacts([])` then a cache/relay load), so for a
// short window `followPubkeysRef.current` is empty or stale. A genuinely
// fresh inbound message that arrives in that window is dropped by the
// follow-gate (`nostrLiveDmSub` :220 / :413). The drop is recoverable —
// it is NOT skip-set-persisted, so the next `refreshDmInbox` re-surfaces
// it — but the live inbox update and the one-shot OS notification for that
// arrival are lost until the user manually refreshes.
//
// This buffer holds the already-decrypted side-effects (inbox entry +
// optional notification) of such drops, capped and only for fresh
// arrivals. When `followPubkeys` later hydrates, `reevaluate` replays the
// surface + notify for any buffered partner that now passes the gate. It
// holds NO ciphertext and never persists — purely an in-memory recovery
// for the hydration window. The buffer is owned per sub instance, so a
// wipe / account switch that tears down the sub drops it atomically.

export interface DeferredFollowGateEntry {
  partnerPubkey: string;
  entry: DmInboxEntry;
  // Notification payload to (re)fire if the partner becomes followed.
  // Undefined for own echoes / non-fresh arrivals that should stay silent.
  notify?: { title: string; body: string };
}

export interface LiveSubFollowGateBuffer {
  // Buffer a fresh inbound dropped purely by the follow-gate.
  defer: (item: DeferredFollowGateEntry) => void;
  // Re-test buffered entries against the now-current follows. Entries that
  // pass are removed and handed to `onPass` (newest-last); the rest stay
  // buffered in case follows are still partially hydrated.
  reevaluate: (follows: Set<string>, onPass: (item: DeferredFollowGateEntry) => void) => void;
  // Drop everything (sub teardown). Atomic with wipe / account switch.
  clear: () => void;
  // Test/observability hook.
  readonly size: number;
}

// Small cap: the hydration window is sub-second, so only a handful of
// wraps can realistically land in it. Bounding the buffer keeps a stuck
// "never hydrates" state (no contacts at all) from growing it unbounded.
export const FOLLOW_GATE_DEFER_CAP = 50;

export function createLiveSubFollowGateBuffer(
  cap: number = FOLLOW_GATE_DEFER_CAP,
): LiveSubFollowGateBuffer {
  // Keyed by inbox-entry id so a wrap delivered twice (multi-relay) only
  // buffers once and a later real ingest can't double-replay it.
  const deferred = new Map<string, DeferredFollowGateEntry>();
  return {
    defer(item) {
      if (deferred.has(item.entry.id)) return;
      // Evict oldest (insertion-order) when at cap so the buffer stays bounded.
      if (deferred.size >= cap) {
        const oldest = deferred.keys().next().value;
        if (oldest !== undefined) deferred.delete(oldest);
      }
      deferred.set(item.entry.id, item);
    },
    reevaluate(follows, onPass) {
      if (deferred.size === 0) return;
      for (const [id, item] of deferred) {
        if (follows.has(item.partnerPubkey)) {
          deferred.delete(id);
          onPass(item);
        }
      }
    },
    clear() {
      deferred.clear();
    },
    get size() {
      return deferred.size;
    },
  };
}
