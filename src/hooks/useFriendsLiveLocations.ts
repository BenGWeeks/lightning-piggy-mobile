import { useEffect, useMemo, useState } from 'react';
import {
  LIVE_LOCATION_PING_KIND,
  collectInboundLiveSessions,
  type InboundLiveSession,
} from '../services/liveLocationService';
import { subscribeLiveLocationPingsMulti } from '../services/nostrLiveLocation';
import { decryptIncomingLivePing } from '../services/liveLocationPingReceive';
import { DEFAULT_RELAYS as DEFAULT_NOSTR_RELAYS } from '../services/nostrService';
import { useNostr } from '../contexts/NostrContext';
import type { SharedLocation } from '../services/locationService';
import type { NostrProfile } from '../types/nostr';

/** A friend currently sharing their live location with me, resolved to a
 *  single map marker. One per peer (latest active session wins). */
export interface FriendLiveLocation {
  pubkey: string;
  sessionId: string;
  lat: number;
  lon: number;
  accuracyMetres: number | null;
  avatarUri: string | null;
}

// Full-Map "friends sharing with me" layer (#206 follow-up). Globalises the
// per-conversation `useConversationLiveLocation` logic: instead of one open
// thread's items, it scans the whole decrypted DM inbox for inbound live
// shares, subscribes to their kind-20069 coordinate pings, and resolves each
// sharer's avatar — so MapScreen can plot every friend currently sharing.
//
// Performance: gated on `enabled` (MapScreen focus) so it costs nothing while
// the map isn't on screen. Discovery is a pure scan with a cheap substring
// pre-filter, split from the per-second expiry check so a 5 000-row inbox is
// only fully walked when it changes — not once a second.
export function useFriendsLiveLocations(opts: { enabled: boolean }): FriendLiveLocation[] {
  const { enabled } = opts;
  const {
    dmInbox,
    contacts,
    fetchProfilesForPubkeys,
    pubkey: myPubkey,
    signerType,
    relays,
    isLoggedIn,
    refreshDmInbox,
  } = useNostr();

  // Force a fresh inbox fetch whenever the Map opens. The aggregator only sees
  // what's in `dmInbox`, so two filters have to be bypassed:
  //   • `force: true` — skips the throttle AND the `since` cutoff (NIP-17 wraps
  //     are randomly back-dated, so a `since` filter misses fresh shares).
  //   • `includeNonFollows: true` — skips the follow gate. Someone sharing their
  //     live location with you has deliberately targeted you, so they belong on
  //     the map whether or not you follow them (matches the per-conversation
  //     view, which shows the share in-thread regardless of follow status).
  // Without includeNonFollows, a non-followed sharer's wraps are dropped before
  // they ever reach `dmInbox` (useDmInbox `passesFollowGate`), so they'd never
  // plot — which is exactly what the on-device debug showed (inboundLoc=0).
  useEffect(() => {
    if (!enabled || !isLoggedIn) return;
    void refreshDmInbox({ force: true, includeNonFollows: true }).catch(() => {});
  }, [enabled, isLoggedIn, refreshDmInbox]);

  // Latest coordinate ping per inbound session, keyed by sessionId.
  const [pingLatest, setPingLatest] = useState<
    Record<string, { location: SharedLocation; ts: number } | undefined>
  >({});
  // 1 Hz tick so expiry filtering drops sessions as their window closes.
  const [secondTick, setSecondTick] = useState(0);
  // Avatars for sharers who aren't in the contact list (fetched on demand).
  const [fetchedProfiles, setFetchedProfiles] = useState<Record<string, NostrProfile | undefined>>(
    {},
  );

  // Pass 1 — walk the inbox ONCE per change (pure, substring-pre-filtered
  // scan in the service). Yields every inbound share with its end flag.
  const inboundSessions = useMemo<InboundLiveSession[]>(
    () => collectInboundLiveSessions(dmInbox),
    [dmInbox],
  );

  // Pass 2 — cheap per-second filter over the (small) session list: an active
  // inbound share has no end marker and a window that's still open.
  const activeSessions = useMemo<InboundLiveSession[]>(() => {
    if (!enabled) return [];
    const now = Date.now();
    return inboundSessions.filter((s) => !s.hasEnd && now < s.startedAt + s.durationMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- secondTick re-runs the Date.now() expiry filter each second so closed shares drop
  }, [inboundSessions, enabled, secondTick]);

  // Stable surrogate so the subscription effect only tears down / re-opens
  // when the active session SET changes, not on every ping or tick.
  const activeKey = useMemo(
    () => activeSessions.map((s) => `${s.pubkey}:${s.sessionId}`).join('|'),
    [activeSessions],
  );

  // Subscribe to kind-20069 pings for each active inbound session. Mirrors the
  // per-conversation viewer; closes when the set changes or the map blurs so
  // we never leak relay subscriptions in the background. ONE combined REQ for
  // all active sessions — one-REQ-per-session floods relays ("too many
  // concurrent REQs") once a handful of friends are sharing.
  useEffect(() => {
    if (!enabled || !isLoggedIn || !myPubkey || activeSessions.length === 0) return;
    const readRelays = relays.filter((r) => r.read).map((r) => r.url);
    const targetRelays = Array.from(new Set([...readRelays, ...DEFAULT_NOSTR_RELAYS]));
    const sessionById = new Map(activeSessions.map((s) => [s.sessionId, s]));
    const since = Math.floor(Math.min(...activeSessions.map((s) => s.startedAt)) / 1000);
    const unsub = subscribeLiveLocationPingsMulti({
      viewerPubkey: myPubkey,
      senderPubkeys: Array.from(new Set(activeSessions.map((s) => s.pubkey))),
      sessionIds: activeSessions.map((s) => s.sessionId),
      kind: LIVE_LOCATION_PING_KIND,
      since,
      relays: targetRelays,
      onEvent: async (ev) => {
        const payload = await decryptIncomingLivePing({
          signerType,
          content: ev.content,
          senderPubkey: ev.pubkey,
          viewerPubkey: myPubkey,
        });
        // Route by sessionId — one REQ carries pings for every watched session.
        if (!payload || !sessionById.has(payload.sessionId)) return;
        setPingLatest((prev) => {
          const existing = prev[payload.sessionId];
          // Drop out-of-order pings — relay fan-out can re-order events and
          // the marker shouldn't jump backwards.
          if (existing && existing.ts >= payload.ts) return prev;
          return {
            ...prev,
            [payload.sessionId]: {
              location: { lat: payload.lat, lon: payload.lon, accuracyMeters: payload.accuracy },
              ts: payload.ts,
            },
          };
        });
      },
    });
    return () => {
      try {
        unsub();
      } catch {
        // best-effort
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activeKey is the stable surrogate for activeSessions
  }, [activeKey, enabled, isLoggedIn, myPubkey, signerType, relays]);

  // Drive the 1 Hz tick only while the map is up AND something is being shared
  // — an idle map (or a map with no inbound shares) never re-renders for this.
  const hasActive = activeSessions.length > 0;
  useEffect(() => {
    if (!enabled || !hasActive) return;
    const id = setInterval(() => setSecondTick((n) => (n + 1) % 1000), 1000);
    return () => clearInterval(id);
  }, [enabled, hasActive]);

  // Avatars: prefer a contact's already-cached picture. Only contacts that
  // actually HAVE a picture go in this map — a followed contact whose kind-0
  // hasn't resolved yet must fall through to the on-demand fetch below, else
  // it's stuck rendering a silhouette forever (the fetch only fired for
  // pubkeys absent from this map).
  const contactPicByPubkey = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contacts) if (c.profile?.picture) m.set(c.pubkey, c.profile.picture);
    return m;
  }, [contacts]);

  const peersKey = useMemo(
    () =>
      Array.from(new Set(activeSessions.map((s) => s.pubkey)))
        .sort()
        .join(','),
    [activeSessions],
  );

  useEffect(() => {
    if (!enabled) return;
    const missing = Array.from(new Set(activeSessions.map((s) => s.pubkey))).filter(
      (pk) => !contactPicByPubkey.has(pk) && !(pk in fetchedProfiles),
    );
    if (missing.length === 0) return;
    let cancelled = false;
    void fetchProfilesForPubkeys(missing).then((map) => {
      if (cancelled) return;
      setFetchedProfiles((prev) => {
        const next = { ...prev };
        for (const pk of missing) next[pk] = map.get(pk);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- peersKey is the stable surrogate for the active peer set
  }, [peersKey, enabled]);

  // Final markers: one per peer (latest active session by start time), plotted
  // at the freshest ping or the start coordinate until a ping lands.
  const friends = useMemo<FriendLiveLocation[]>(() => {
    const byPeer = new Map<string, InboundLiveSession>();
    for (const s of activeSessions) {
      const cur = byPeer.get(s.pubkey);
      if (!cur || s.startedAt > cur.startedAt) byPeer.set(s.pubkey, s);
    }
    const out: FriendLiveLocation[] = [];
    for (const s of byPeer.values()) {
      const loc = pingLatest[s.sessionId]?.location ?? s.startLocation;
      const avatarUri =
        contactPicByPubkey.get(s.pubkey) ?? fetchedProfiles[s.pubkey]?.picture ?? null;
      out.push({
        pubkey: s.pubkey,
        sessionId: s.sessionId,
        lat: loc.lat,
        lon: loc.lon,
        accuracyMetres: loc.accuracyMeters,
        avatarUri,
      });
    }
    return out;
  }, [activeSessions, pingLatest, contactPicByPubkey, fetchedProfiles]);

  return friends;
}
