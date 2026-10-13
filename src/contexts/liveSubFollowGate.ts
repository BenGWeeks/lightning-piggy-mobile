import { isFollowed } from '../utils/followPubkeys';
import type { DmInboxEntry } from '../utils/conversationSummaries';
import type { DecodedRumor } from '../utils/nip17Unwrap';

// Per-sub, bounded recovery during follow reconciliation (#851 / #1458).
// Both kind-4 and kind-1059 hold decrypted inbox previews in memory while
// follows load. Backlog replays silently; only fresh inbound carries a
// notification. No ciphertext or secrets are persisted by this buffer.
// Cached friends can replay after the offline timeout; unmatched entries
// remain recoverable until reconciliation completes (which clears strangers).
// Teardown clears the buffer atomically with the subscription.

export interface DeferredFollowGateEntry {
  partnerPubkey: string;
  entry: DmInboxEntry;
  // A two-party chat must be re-routed after trust hydrates: a preceding
  // subject-tagged rumor may establish its room. Preserve the original tags.
  groupRumor?: DecodedRumor;
  // Notification payload to (re)fire if the partner becomes followed.
  // Undefined for own echoes / non-fresh arrivals that should stay silent.
  notify?: { title: string; body: string };
}

export interface LiveSubFollowGateBuffer {
  // Buffer an inbound deferred while follows reconcile.
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

// Bound memory even when reconciliation is slow or never completes offline.
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
        if (isFollowed(follows, item.partnerPubkey)) {
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
