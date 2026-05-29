import { useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { LIVE_LOCATION_PING_KIND, decodeLivePingPayload } from '../services/liveLocationService';
import { subscribeLiveLocationPings } from '../services/nostrLiveLocation';
import {
  decodeNsec,
  decryptNip04WithSecret,
  DEFAULT_RELAYS as DEFAULT_NOSTR_RELAYS,
} from '../services/nostrService';
import * as amberService from '../services/amberService';
import { useLiveLocation } from '../contexts/LiveLocationContext';
import type { SharedLocation } from '../services/locationService';
import type { Item } from '../utils/conversationItems';
import type { RelayConfig } from '../types/nostr';

type LiveStatus = 'active' | 'paused' | 'ended' | 'expired' | undefined;

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
          // Decrypt the ciphertext content with whichever signer is active.
          // Amber goes through the platform IPC; nsec uses the local secret.
          // Either way the decoded JSON is fed into `decodeLivePingPayload`
          // which validates ranges.
          let plaintext: string | null = null;
          try {
            if (signerType === 'nsec') {
              const nsec = await SecureStore.getItemAsync('nostr_nsec');
              if (!nsec) return;
              const { secretKey } = decodeNsec(nsec);
              plaintext = await decryptNip04WithSecret(secretKey, ev.pubkey, ev.content);
            } else if (signerType === 'amber') {
              plaintext = await amberService.requestNip04Decrypt(ev.content, ev.pubkey, myPubkey);
            }
          } catch {
            return;
          }
          if (!plaintext) return;
          const payload = decodeLivePingPayload(plaintext);
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
  const liveLocationBubbleStatus = useMemo<Record<string, LiveStatus>>(() => {
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

  const liveLocationBubbleRemaining = useMemo<Record<string, number | undefined>>(() => {
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

  // Drive the 1 Hz tick declared above — flips the counter the Date.now() memos depend on.
  useEffect(() => {
    const id = setInterval(() => setSecondTick((n) => (n + 1) % 1000), 1000);
    return () => clearInterval(id);
  }, []);

  // What the bubble plots: end-marker coords (last position sent/received once ended — the sender has no inbound pings, so this shows their final spot, not stale start coords) as the base, with live pings overriding for shares still streaming.
  const liveLocationLatest = useMemo(() => {
    const merged: Record<string, { location: SharedLocation; ts: number } | undefined> = {};
    for (const it of items) {
      if (it.kind !== 'liveLocationMarker') continue;
      if (it.marker.phase !== 'end' || !it.marker.location) continue;
      merged[it.marker.sessionId] = { location: it.marker.location, ts: it.createdAt * 1000 };
    }
    return { ...merged, ...pingLatest };
  }, [items, pingLatest]);

  return { liveLocationLatest, liveLocationBubbleStatus, liveLocationBubbleRemaining };
}
