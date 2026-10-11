import { useEffect, useMemo, useRef, useState } from 'react';
import {
  collectInboundLiveSessions,
  type InboundLiveSession,
} from '../services/liveLocationService';
import { DM_INBOX_REFRESH_TTL_MS } from '../contexts/nostrDmCache';
import { liveKey } from '../services/liveLocationUpdateStore';
import { useNostr, useNostrContacts, useNostrDmInbox } from '../contexts/NostrContext';
import type { NostrProfile } from '../types/nostr';
import {
  useLiveUpdateRelaySubscriptions,
  useLiveUpdates,
  type WatchedShare,
} from './useLiveUpdates';

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
// shares, watches their coordinate updates, and resolves each
// sharer's avatar — so MapScreen can plot every friend currently sharing.
//
// Performance: gated on `enabled` (MapScreen focus) so it costs nothing while
// the map isn't on screen. Discovery is a pure scan with a cheap substring
// pre-filter, split from the per-second expiry check so a 5 000-row inbox is
// only fully walked when it changes — not once a second.
export function useFriendsLiveLocations(opts: { enabled: boolean }): FriendLiveLocation[] {
  const { enabled } = opts;
  const { fetchProfilesForPubkeys, pubkey: myPubkey, signerType, relays, isLoggedIn } = useNostr();
  const { dmInbox, refreshDmInbox } = useNostrDmInbox();
  const { contacts } = useNostrContacts();

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
  //
  // Throttled to the same 30 s TTL the Messages tab uses: a `force` refresh is a
  // full NIP-17 re-decrypt (~14.8 s / 500+ wraps on a busy inbox) AND
  // `includeNonFollows` bypasses the #743 skip-set, so firing it on every focus
  // transition (tab tap, pop back from a conversation, dismiss a sheet) would
  // pin the JS thread repeatedly. Once per 30 s is plenty — the live DM
  // subscription surfaces anything newer in real time.
  const lastForceRefreshRef = useRef(0);
  useEffect(() => {
    if (!enabled || !isLoggedIn) return;
    const now = performance.now();
    if (
      lastForceRefreshRef.current > 0 &&
      now - lastForceRefreshRef.current < DM_INBOX_REFRESH_TTL_MS
    ) {
      return;
    }
    lastForceRefreshRef.current = now;
    void refreshDmInbox({ force: true, includeNonFollows: true }).catch(() => {});
  }, [enabled, isLoggedIn, refreshDmInbox]);

  // 1 Hz tick so expiry filtering drops sessions as their window closes.
  const [secondTick, setSecondTick] = useState(0);
  // Avatars for sharers who aren't in the contact list (fetched on demand).
  const [fetchedProfiles, setFetchedProfiles] = useState<Record<string, NostrProfile | undefined>>(
    {},
  );

  // Pass 1 — walk the inbox ONCE per change (pure, substring-pre-filtered
  // scan in the service). Yields every inbound share with its end flag.
  const inboundSessions = useMemo<InboundLiveSession[]>(
    // `renderText` holds the marker itself; `text` is the list preview (#1300).
    () => collectInboundLiveSessions(dmInbox.map((e) => ({ ...e, text: e.renderText ?? e.text }))),
    [dmInbox],
  );

  // Pass 2 — cheap per-second filter over the (small) session list: an active
  // inbound share has no end marker and a window that's still open. The 1 Hz
  // `secondTick` re-runs this so expired shares drop — but `Array.filter`
  // returns a NEW array each tick even when nothing changed, which would
  // cascade a 1 Hz re-render through `friends` → MapScreen. Return the previous
  // reference when the session set is identical so the chain stays still.
  const prevActiveRef = useRef<InboundLiveSession[]>([]);
  const activeSessions = useMemo<InboundLiveSession[]>(() => {
    if (!enabled) {
      prevActiveRef.current = [];
      return prevActiveRef.current;
    }
    const now = Date.now();
    const next = inboundSessions.filter((s) => !s.hasEnd && now < s.startedAt + s.durationMs);
    const prev = prevActiveRef.current;
    if (next.length === prev.length && next.every((s, i) => s === prev[i])) return prev;
    prevActiveRef.current = next;
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- secondTick re-runs the Date.now() expiry filter each second so closed shares drop
  }, [inboundSessions, enabled, secondTick]);

  // Coordinate updates: Marmot ones arrive over MLS; NIP-17 (session-key) and
  // legacy ones through ONE bounded relay REQ each — all into the coalesced
  // update store (#1300), so the map re-renders at most once per flush.
  const watched = useMemo<WatchedShare[]>(
    () =>
      activeSessions.map((s) => ({
        sender: s.pubkey,
        sessionId: s.sessionId,
        startedAt: s.startedAt,
        ...(s.updateKey ? { updateKey: s.updateKey } : {}),
        ...(s.marmot ? { marmot: true } : {}),
      })),
    [activeSessions],
  );
  useLiveUpdateRelaySubscriptions({
    shares: watched,
    enabled: enabled && isLoggedIn,
    myPubkey,
    signerType,
    relays,
  });
  const updates = useLiveUpdates(watched);

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
      const loc = updates[liveKey(s.pubkey, s.sessionId)]?.location ?? s.startLocation;
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
  }, [activeSessions, updates, contactPicByPubkey, fetchedProfiles]);

  return friends;
}
