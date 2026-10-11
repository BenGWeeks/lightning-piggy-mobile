import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveLocation } from '../contexts/LiveLocationContext';
import type { LiveLocationMarker } from '../services/liveLocationService';
import type { SharedLocation } from '../services/locationService';
import type { Item } from '../utils/conversationItems';
import type { RelayConfig } from '../types/nostr';
import {
  useLiveUpdateRelaySubscriptions,
  useLiveUpdates,
  type WatchedShare,
} from './useLiveUpdates';

type LiveStatus = 'active' | 'paused' | 'ended' | 'expired' | undefined;

// Stabilise an object's identity across renders (#778). The status / remaining
// read-models below are rebuilt every 1 Hz `secondTick`, handing back a NEW
// Record each second even when nothing changed. That new reference flows into
// ConversationScreen's `renderItem` deps → a new `renderItem` → FlatList
// re-evaluates every visible row → every `ConversationMessageRow` (React.memo,
// shallow compare) re-renders once a second during a live share. Returning the
// PREVIOUS object when its content is unchanged (cheap JSON compare — these
// maps hold at most a handful of small entries) keeps `renderItem` stable, so
// only the countdown bubble's own row re-renders when its value actually moves.
export function useStableRecord<T extends object>(next: T): T {
  const prevRef = useRef<T>(next);
  if (JSON.stringify(next) === JSON.stringify(prevRef.current)) return prevRef.current;
  prevRef.current = next;
  return next;
}

/** One live-location marker in a thread, from whichever transport. */
export interface ThreadLiveMarker {
  fromMe: boolean;
  /** Hex pubkey of whoever sent the marker. */
  sender: string;
  marker: LiveLocationMarker;
  /** Message timestamp (unix seconds). */
  createdAt: number;
}

/**
 * Receive-side live-location plumbing for one thread — a 1:1 chat or a group
 * (#206, #1300). Transport-agnostic: coordinate updates come out of the
 * coalesced update store, fed by the Marmot listener (Marmot threads) or by
 * the relay subscriptions opened here (NIP-17 threads). Owns the per-session
 * status / remaining-ms read models the bubble renders, and a 1 Hz tick so
 * "Updated 30 s ago" labels animate without re-rendering on every update.
 */
export function useLiveLocationThread(params: {
  markers: ThreadLiveMarker[];
  /** Peer pubkey (1:1) or group id — where my own sessions are filed. */
  threadKey: string;
  marmot: boolean;
  isLoggedIn: boolean;
  myPubkey: string | null;
  signerType: string | null;
  relays: RelayConfig[];
}) {
  const { markers, threadKey, marmot, isLoggedIn, myPubkey, signerType, relays } = params;
  const { sessionsByRecipient, remainingMsForSession } = useLiveLocation();

  // 1 Hz tick — included in the Date.now()-dependent memos below so countdown / "x ago" labels stay live and expired sessions actually drop between updates.
  const [secondTick, setSecondTick] = useState(0);

  const endedIds = useMemo(() => {
    const out = new Set<string>();
    for (const m of markers) if (m.marker.phase === 'end') out.add(m.marker.sessionId);
    return out;
  }, [markers]);

  // Inbound shares still running: a start from someone else, no end yet, and
  // inside its wall-clock window.
  const watched = useMemo<WatchedShare[]>(() => {
    const now = Date.now();
    const out: WatchedShare[] = [];
    for (const m of markers) {
      if (m.fromMe || m.marker.phase !== 'start' || endedIds.has(m.marker.sessionId)) continue;
      if (now >= m.marker.startedAt + m.marker.durationMs) continue;
      out.push({
        sender: m.sender,
        sessionId: m.marker.sessionId,
        startedAt: m.marker.startedAt,
        ...(m.marker.updateKey ? { updateKey: m.marker.updateKey } : {}),
        // A v2 marker in a Marmot thread streams over MLS; a legacy one (an
        // older build) still sends NIP-04 pings, so keep the relay REQ for it.
        ...(marmot && m.marker.v2 ? { marmot: true } : {}),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- secondTick re-runs the Date.now() expiry filter each second so expired shares drop
  }, [markers, endedIds, marmot, secondTick]);

  useLiveUpdateRelaySubscriptions({
    shares: watched,
    enabled: isLoggedIn,
    myPubkey,
    signerType,
    relays,
  });
  const updates = useLiveUpdates(watched);

  // Per-session status the bubble renders: `ended` once an end marker arrives,
  // otherwise the context's authoritative status for our own shares, otherwise
  // active/ended by wall-clock for inbound shares.
  const liveLocationBubbleStatusRaw = useMemo<Record<string, LiveStatus>>(() => {
    const out: Record<string, LiveStatus> = {};
    const mine = sessionsByRecipient.get(threadKey);
    for (const m of markers) {
      const id = m.marker.sessionId;
      if (endedIds.has(id)) {
        out[id] = 'ended';
        continue;
      }
      const own = mine?.find((s) => s.sessionId === id);
      if (own) {
        out[id] = own.status;
        continue;
      }
      const expiresAt = m.marker.startedAt + m.marker.durationMs;
      out[id] = Date.now() >= expiresAt ? 'ended' : 'active';
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- secondTick re-runs the Date.now() wall-clock status each second
  }, [markers, endedIds, sessionsByRecipient, threadKey, secondTick]);
  const liveLocationBubbleStatus = useStableRecord(liveLocationBubbleStatusRaw);

  const liveLocationBubbleRemainingRaw = useMemo<Record<string, number | undefined>>(() => {
    const out: Record<string, number | undefined> = {};
    const now = Date.now();
    for (const m of markers) {
      if (m.marker.phase !== 'start') continue;
      const id = m.marker.sessionId;
      // Sender path: the context's remaining-ms matches the watcher's clock.
      const fromCtx = remainingMsForSession(id);
      out[id] =
        fromCtx !== null ? fromCtx : Math.max(0, m.marker.startedAt + m.marker.durationMs - now);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- secondTick re-runs the Date.now() remaining-time countdown each second
  }, [markers, remainingMsForSession, secondTick]);
  // NOTE: remaining-ms DOES change each second for an active share, so the
  // countdown bubble's own row still re-renders every tick (#778).
  const liveLocationBubbleRemaining = useStableRecord(liveLocationBubbleRemainingRaw);

  // Drive the 1 Hz tick only when the thread actually has a live-location bubble.
  const hasLiveMarkers = markers.length > 0;
  useEffect(() => {
    if (!hasLiveMarkers) return;
    const id = setInterval(() => setSecondTick((n) => (n + 1) % 1000), 1000);
    return () => clearInterval(id);
  }, [hasLiveMarkers]);

  // What the bubble plots: live updates while a share streams; once it ends,
  // the end marker's coords (the sender's final spot) win.
  const liveLocationLatest = useMemo(() => {
    const merged: Record<string, { location: SharedLocation; ts: number } | undefined> = {
      ...updates,
    };
    for (const m of markers) {
      if (m.marker.phase !== 'end' || !m.marker.location) continue;
      merged[m.marker.sessionId] = { location: m.marker.location, ts: m.createdAt * 1000 };
    }
    return merged;
  }, [markers, updates]);

  return { liveLocationLatest, liveLocationBubbleStatus, liveLocationBubbleRemaining };
}

// 1:1 ConversationScreen adapter (#206): pulls the classified live-location
// markers out of the thread's items. Extracted from the screen (#703 size cap).
export function useConversationLiveLocation(params: {
  items: Item[];
  isLoggedIn: boolean;
  myPubkey: string | null;
  pubkey: string;
  signerType: string | null;
  relays: RelayConfig[];
  marmot?: boolean;
}) {
  const { items, pubkey, myPubkey } = params;
  const markers = useMemo<ThreadLiveMarker[]>(() => {
    const out: ThreadLiveMarker[] = [];
    for (const it of items) {
      if (it.kind !== 'liveLocationMarker') continue;
      out.push({
        fromMe: it.fromMe,
        sender: it.fromMe ? (myPubkey ?? '') : pubkey,
        marker: it.marker,
        createdAt: it.createdAt,
      });
    }
    return out;
  }, [items, myPubkey, pubkey]);
  // Same items array → same markers; keep the reference stable across renders
  // that rebuild `items` without touching a live marker.
  const stableMarkers = useStableRecord(markers);
  return useLiveLocationThread({
    ...params,
    markers: stableMarkers,
    threadKey: pubkey,
    marmot: params.marmot ?? false,
  });
}
