import { useEffect, useMemo, useRef, useState } from 'react';
import { LIVE_LOCATION_PING_KIND } from '../services/liveLocationService';
import { subscribeLiveLocationPings } from '../services/nostrLiveLocation';
import { decryptIncomingLivePing } from '../services/liveLocationPingReceive';
import { DEFAULT_RELAYS as DEFAULT_NOSTR_RELAYS } from '../services/nostrService';
import { useLiveLocation } from '../contexts/LiveLocationContext';
import type { SharedLocation } from '../services/locationService';
import type { Item } from '../utils/conversationItems';
import type { RelayConfig } from '../types/nostr';

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

// Receive-side live-location plumbing for the 1:1 ConversationScreen (#206).
// Extracted from the screen (#703 size cap): owns the kind-20069 coordinate
// subscription, the per-session status/remaining-ms read models the bubble
// renders, and a 1 Hz tick so the "Updated 30 s ago" labels animate without
// re-rendering on every ping. Sending a share stays in the screen — it drives
// the chooser sheet + LiveLocationProvider.
export function useConversationLiveLocation(params: {
  items: Item[];
  isLoggedIn: boolean;
  myPubkey: string | null;
  pubkey: string;
  signerType: string | null;
  relays: RelayConfig[];
}) {
  const { items, isLoggedIn, myPubkey, pubkey, signerType, relays } = params;
  const { sessionsByRecipient, remainingMsForSession } = useLiveLocation();

  // Latest known coordinate per inbound live-share session, keyed by
  // sessionId. Fed by the kind-20069 subscription below; consumed by
  // MessageBubble's `liveLocationMarker` branch so the receiver's bubble
  // updates as new pings arrive.
  // Live coordinate pings (inbound shares only) keyed by sessionId. Merged
  // with end-marker locations below into the `liveLocationLatest` the bubble reads.
  const [pingLatest, setPingLatest] = useState<
    Record<string, { location: SharedLocation; ts: number } | undefined>
  >({});

  // 1 Hz tick — included in the Date.now()-dependent memos below so countdown / "x ago" labels stay live and expired sessions actually drop between pings.
  const [secondTick, setSecondTick] = useState(0);

  // Find inbound (fromMe=false) start markers whose paired end marker
  // (same sessionId) hasn't arrived AND whose wall-clock window is still
  // open. The classifier already split markers out into a dedicated kind,
  // so we walk `items` directly. Memoised so a new `items` array on every
  // render doesn't tear down + recreate the relay subscriptions below.
  const liveStarts = useMemo(() => {
    const seenEnds = new Set<string>();
    for (const it of items) {
      if (it.kind !== 'liveLocationMarker') continue;
      if (it.marker.phase === 'end') seenEnds.add(it.marker.sessionId);
    }
    const starts: { sessionId: string; startedAt: number; durationMs: number }[] = [];
    for (const it of items) {
      if (it.kind !== 'liveLocationMarker') continue;
      if (it.fromMe) continue;
      if (it.marker.phase !== 'start') continue;
      if (seenEnds.has(it.marker.sessionId)) continue;
      const expiresAt = it.marker.startedAt + it.marker.durationMs;
      if (Date.now() >= expiresAt) continue;
      starts.push({
        sessionId: it.marker.sessionId,
        startedAt: it.marker.startedAt,
        durationMs: it.marker.durationMs,
      });
    }
    return starts;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- secondTick forces the Date.now() expiry filter to re-run each second so expired sessions drop
  }, [items, secondTick]);

  // Stable key over the live-share set — the subscription effect depends
  // on this instead of `liveStarts`, so it only re-subscribes when a
  // session actually appears / expires, not on every keystroke render.
  const liveStartsKey = useMemo(
    () => liveStarts.map((s) => `${s.sessionId}:${s.startedAt}:${s.durationMs}`).join('|'),
    [liveStarts],
  );

  // Subscribe to live-location coordinate pings (kind-20069) for any
  // *inbound* live-share start marker we've seen in this thread that hasn't
  // yet been ended. The subscription stays open until either an end marker
  // arrives or the share's wall-clock window expires — we close it then so we
  // don't leak relay subs on long chats with many historical live shares.
  useEffect(() => {
    if (!isLoggedIn || !myPubkey) return;
    const readRelays = relays.filter((r) => r.read).map((r) => r.url);
    const targetRelays = Array.from(new Set([...readRelays, ...DEFAULT_NOSTR_RELAYS]));
    if (liveStarts.length === 0) return;
    const unsubs: (() => void)[] = [];
    for (const start of liveStarts) {
      const unsub = subscribeLiveLocationPings({
        viewerPubkey: myPubkey,
        senderPubkey: pubkey,
        sessionId: start.sessionId,
        kind: LIVE_LOCATION_PING_KIND,
        // Spec-conformant ephemeral relays drop pings on disconnect so we get
        // a tiny `since` window; non-conformant relays might still hold one in
        // memory, so accept anything from this session's start time onward.
        since: Math.floor(start.startedAt / 1000),
        relays: targetRelays,
        onEvent: async (ev) => {
          const payload = await decryptIncomingLivePing({
            signerType,
            content: ev.content,
            senderPubkey: ev.pubkey,
            viewerPubkey: myPubkey,
          });
          if (!payload || payload.sessionId !== start.sessionId) return;
          setPingLatest((prev) => {
            const existing = prev[start.sessionId];
            // Reject out-of-order pings — relay fan-out can briefly re-order
            // events, and the receiver's bubble shouldn't jump backwards.
            if (existing && existing.ts >= payload.ts) return prev;
            return {
              ...prev,
              [start.sessionId]: {
                location: {
                  lat: payload.lat,
                  lon: payload.lon,
                  accuracyMeters: payload.accuracy,
                },
                ts: payload.ts,
              },
            };
          });
        },
      });
      unsubs.push(unsub);
    }
    return () => {
      for (const unsub of unsubs) {
        try {
          unsub();
        } catch {
          // best-effort
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- liveStartsKey is the stable surrogate for liveStarts
  }, [liveStartsKey, isLoggedIn, myPubkey, pubkey, signerType, relays]);

  // Per-session status the bubble renders: `ended` once an end marker arrives,
  // otherwise the context's authoritative status for our own shares, otherwise
  // active/ended by wall-clock for inbound shares.
  const liveLocationBubbleStatusRaw = useMemo<Record<string, LiveStatus>>(() => {
    const out: Record<string, LiveStatus> = {};
    const seenEndIds = new Set<string>();
    for (const it of items) {
      if (it.kind !== 'liveLocationMarker') continue;
      if (it.marker.phase === 'end') seenEndIds.add(it.marker.sessionId);
    }
    for (const it of items) {
      if (it.kind !== 'liveLocationMarker') continue;
      const id = it.marker.sessionId;
      if (seenEndIds.has(id)) {
        out[id] = 'ended';
        continue;
      }
      // Outgoing session: defer to the live-location context for the
      // authoritative status (active / paused / expired).
      const own = sessionsByRecipient.get(pubkey)?.find((s) => s.sessionId === id);
      if (own) {
        out[id] = own.status;
        continue;
      }
      // Incoming, no end marker, expiry not reached → active.
      const expiresAt = it.marker.startedAt + it.marker.durationMs;
      out[id] = Date.now() >= expiresAt ? 'ended' : 'active';
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- secondTick re-runs the Date.now() wall-clock status each second
  }, [items, sessionsByRecipient, pubkey, secondTick]);
  // Keep a stable reference while content is unchanged so the 1 Hz tick doesn't
  // churn ConversationScreen's renderItem (#778).
  const liveLocationBubbleStatus = useStableRecord(liveLocationBubbleStatusRaw);

  const liveLocationBubbleRemainingRaw = useMemo<Record<string, number | undefined>>(() => {
    const out: Record<string, number | undefined> = {};
    const now = Date.now();
    for (const it of items) {
      if (it.kind !== 'liveLocationMarker') continue;
      if (it.marker.phase !== 'start') continue;
      const id = it.marker.sessionId;
      // Sender path: prefer the canonical remaining-ms from the context, since
      // its `startedAt` matches the wall clock the watcher uses.
      const fromCtx = remainingMsForSession(id);
      if (fromCtx !== null) {
        out[id] = fromCtx;
        continue;
      }
      const expiresAt = it.marker.startedAt + it.marker.durationMs;
      out[id] = Math.max(0, expiresAt - now);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- secondTick re-runs the Date.now() remaining-time countdown each second
  }, [items, remainingMsForSession, secondTick]);
  // Stable reference while content is unchanged (#778). NOTE: the remaining-ms
  // values DO change each second for an active share, so the countdown bubble's
  // own row still re-renders every tick — only unrelated rows are spared.
  const liveLocationBubbleRemaining = useStableRecord(liveLocationBubbleRemainingRaw);

  // Drive the 1 Hz tick declared above — but only when the thread actually has a live-location bubble, so chats with none don't re-render once a second for nothing.
  const hasLiveMarkers = useMemo(
    () => items.some((it) => it.kind === 'liveLocationMarker'),
    [items],
  );
  useEffect(() => {
    if (!hasLiveMarkers) return;
    const id = setInterval(() => setSecondTick((n) => (n + 1) % 1000), 1000);
    return () => clearInterval(id);
  }, [hasLiveMarkers]);

  // What the bubble plots: live pings are the base for shares still streaming;
  // once a share ends, its end-marker coords (the sender's final spot, not a
  // stale start/ping coordinate) take precedence — so end markers are spread
  // LAST, overriding any lingering ping for the same session.
  const liveLocationLatest = useMemo(() => {
    const merged: Record<string, { location: SharedLocation; ts: number } | undefined> = {};
    for (const it of items) {
      if (it.kind !== 'liveLocationMarker') continue;
      if (it.marker.phase !== 'end' || !it.marker.location) continue;
      merged[it.marker.sessionId] = { location: it.marker.location, ts: it.createdAt * 1000 };
    }
    return { ...pingLatest, ...merged };
  }, [items, pingLatest]);

  return { liveLocationLatest, liveLocationBubbleStatus, liveLocationBubbleRemaining };
}
