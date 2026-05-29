import type { Filter } from 'nostr-tools/filter';
import { pool, trackRelays, DM_INBOX_LIMIT, type RawInboxDmEvent } from './nostrService';

// Live sub never looks further back than this — caps cold-start restream
// cost when inboxLastSeen is very stale (e.g. user hasn't opened the app in
// weeks). The bulk fetch (fetchInboxDmEvents) handles deeper backfill on tab
// open.
const DM_LIVE_SUB_MAX_LOOKBACK_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Long-lived kind-4 (NIP-04) + kind-1059 (NIP-17 gift wrap) inbox
 * subscription for the current viewer (#349). Returns a cleanup function.
 *
 * Extracted from nostrService (#703 — keep that over-cap file from growing);
 * behaviour is unchanged. The `onEose` callback (added for #279) fires once
 * after BOTH filters reach end-of-stored-events so callers can tell the
 * historical replay from genuinely-live events (used to suppress backlog
 * notifications on cold start).
 */
export function subscribeInboxDmsForViewer(input: {
  viewerPubkey: string;
  relays: string[];
  onEvent: (ev: RawInboxDmEvent) => void;
  // Fires once after BOTH the kind-4 and kind-1059 subscriptions have each
  // reached end-of-stored-events (EOSE). NB: nostr-tools' `subscribeMany`
  // delivers `oneose` PER RELAY, so this resolves on the FIRST (fastest)
  // relay's EOSE for each filter — not after every relay has finished
  // replaying its backlog. That imprecision is deliberately tolerated:
  // cold-start OS-notification suppression does NOT depend on EOSE timing —
  // it is gated per-event by the `isFreshArrival` timestamp check in the
  // live DM sub (#282), so a slow relay replaying backlog late cannot
  // reintroduce a notification flood. Callers use this only as a coarse
  // "initial replay has begun to settle" signal.
  onEose?: () => void;
  // Optional kind-4 `since` cursor (unix seconds). When provided, the kind-4 filter resolves to `clamp(providedSince - 120s, now-7d, now)` — the 120 s safety buffer in case relay clock skew tagged a wrap slightly older than our cursor, the 7-day floor caps cold-start restream when the cursor is very stale, and the `now` cap defends against a future-dated cursor (corrupted persisted value or a wrap with a bad clock) that would otherwise silently miss new DMs until wall-clock catches up. If absent, falls back to the 7-day floor.
  sinceK4?: number;
  // Cap on the kind-1059 backlog the relay re-streams when the sub opens.
  // Wraps can't use a `since` cursor (randomised NIP-59 timestamps), so without
  // a bound the relay replays the FULL wrap history on every arm and nostr-tools
  // parses every event synchronously before our knownWrapIds early-return —
  // re-introducing the cold-start ingest freeze via the live-sub path even when
  // refreshDmInbox capped its own fetch (#751, Copilot review on #752). Defaults
  // to DM_INBOX_LIMIT; callers pass the smaller cold-start limit. New wraps still
  // arrive live after EOSE regardless of this cap, and the deeper backlog is
  // covered by refreshDmInbox's deferred full backfill.
  wrapsLimit?: number;
}): () => void {
  trackRelays(input.relays);
  const onevent = (ev: Parameters<typeof input.onEvent>[0]): void => {
    input.onEvent(ev);
  };
  // Fire `onEose` exactly once, after both filters have reached EOSE.
  let k4Eosed = false;
  let wrapsEosed = false;
  const maybeEose = (): void => {
    if (k4Eosed && wrapsEosed) input.onEose?.();
  };
  const nowSec = Math.floor(Date.now() / 1000);
  const lookbackFloor = nowSec - DM_LIVE_SUB_MAX_LOOKBACK_SECONDS;
  const requested = input.sinceK4 !== undefined ? Math.max(0, input.sinceK4 - 120) : lookbackFloor;
  // Upper-bound at `nowSec` so a future-dated persisted cursor (or one bumped by a wrap with a bad created_at) doesn't drop us into a `since` in the future where the relay returns nothing.
  const sinceK4 = Math.min(nowSec, Math.max(lookbackFloor, requested));
  const subK4 = pool.subscribeMany(
    input.relays,
    {
      kinds: [4],
      '#p': [input.viewerPubkey],
      since: sinceK4,
      limit: DM_INBOX_LIMIT,
    } as Filter,
    {
      onevent,
      oneose: () => {
        if (!k4Eosed) {
          k4Eosed = true;
          maybeEose();
        }
      },
    },
  );
  const subWraps = pool.subscribeMany(
    input.relays,
    {
      kinds: [1059],
      '#p': [input.viewerPubkey],
      // No `since` — NIP-59 random timestamps would drop fresh wraps. Bound the
      // backlog re-stream with `wrapsLimit` instead (see the input doc above).
      limit: input.wrapsLimit ?? DM_INBOX_LIMIT,
    } as Filter,
    {
      onevent,
      oneose: () => {
        if (!wrapsEosed) {
          wrapsEosed = true;
          maybeEose();
        }
      },
    },
  );
  return () => {
    for (const s of [subK4, subWraps]) {
      try {
        s.close();
      } catch {
        // best-effort
      }
    }
  };
}
