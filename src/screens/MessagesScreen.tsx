import React, { useState, useMemo, useCallback, useRef, useEffect, useDeferredValue } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  RefreshControl,
  InteractionManager,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import TabBackgroundImage from '../components/TabBackgroundImage';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import Svg, { Path } from 'react-native-svg';
import { Clock, Search, X, Zap } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, CompositeNavigationProp, useFocusEffect } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNostr } from '../contexts/NostrContext';
import { useWallet } from '../contexts/WalletContext';
import { useGroups } from '../contexts/GroupsContext';
import { useTrustGraph } from '../contexts/TrustGraphContext';
import WebOfTrustChip from '../components/WebOfTrustChip';
import WebOfTrustBottomSheet from '../components/WebOfTrustBottomSheet';
import ConversationRow from '../components/ConversationRow';
import GroupRow from '../components/GroupRow';
import type { ContactInfo } from '../components/GroupAvatar';
import FriendPickerSheet, { type PickedFriend } from '../components/FriendPickerSheet';
import ContactProfileSheet from '../components/ContactProfileSheet';
import type { ContactProfileBodyData } from '../components/ContactProfileBody';
import CreateGroupSheet from '../components/CreateGroupSheet';
import type { GroupSummary } from '../types/groups';
import { MessageCircle } from 'lucide-react-native';
import TabHeader from '../components/TabHeader';
import { useThemeColors } from '../contexts/ThemeContext';
import {
  buildConversationSummaries,
  buildDmSummaries,
  conversationPreview,
  mergeSummaries,
  type ConversationSummary,
} from '../utils/conversationSummaries';
import { createMessagesScreenStyles } from '../styles/MessagesScreen.styles';
import type { MainTabParamList, RootStackParamList } from '../navigation/types';
import type { NostrProfile } from '../types/nostr';

type MessagesNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Messages'>,
  NativeStackNavigationProp<RootStackParamList>
>;

const MessagesScreen: React.FC = () => {
  const colors = useThemeColors();
  // First-render marker: fires once per mount when the first commit lands. Distinct from refreshDmInbox completion (which fires later, after relay round-trip). Used by scripts/perf-startup.sh to measure tap-to-render latency for tab-messages.
  const messagesRenderLoggedRef = useRef(false);
  useEffect(() => {
    if (messagesRenderLoggedRef.current) return;
    messagesRenderLoggedRef.current = true;
    console.log(`[Perf] MessagesScreen first render`);
  }, []);
  const styles = useMemo(() => createMessagesScreenStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<MessagesNavigation>();
  const {
    isLoggedIn,
    profile,
    contacts,
    refreshContacts,
    refreshProfile,
    dmInbox,
    refreshDmInbox,
    armLiveDmSub,
    fetchProfilesForPubkeys,
    pubkey,
  } = useNostr();
  const { wallets } = useWallet();
  const { groupSummaries, effectiveWotTier } = useGroups();
  // `trustSetForTier` rather than the raw `trustSet` so the screen's
  // defensive trust filter is computed against `effectiveWotTier`. The
  // persisted `wotTier` can be 'all' while the hard-lock clamps the
  // effective tier back to 'friends' (secretMode off) — if we evaluated
  // against the persisted set, the L2 entries would still be included
  // and the filter would no-op past the parental-control gate (#547
  // follow-up).
  const { trustSetForTier } = useTrustGraph();
  // WoT bottom-sheet visibility — opened from the chip in the filter row.
  // Mirrors MapScreen's setWotSheetVisible pattern (#547).
  const [wotSheetVisible, setWotSheetVisible] = useState(false);
  // Production hard-lock (#547): the data + UI layers still apply the
  // trust filter unless the effective tier is 'all'. effectiveWotTier
  // already collapses 'all' → 'friends' for non-secret-mode users, so a
  // stale persisted 'all' can't leak past the parental-control gate.
  const enforceFollowingOnly = effectiveWotTier !== 'all';
  // Tracks last applied value so toggling triggers a data-layer refresh, not just a UI re-filter.
  const lastAppliedEnforceRef = useRef<boolean>(true);
  const [search, setSearch] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [createGroupVisible, setCreateGroupVisible] = useState(false);
  const [sheetContact, setSheetContact] = useState<ContactProfileBodyData | null>(null);
  const [profileSheetVisible, setProfileSheetVisible] = useState(false);
  const [windowDays, setWindowDays] = useState<30 | 90>(30);
  // Default OFF so the inbox starts as DMs-only (#147). When ON, the
  // memo below re-merges zap-counterparty rows into the conversation
  // list so users who primarily zap (vs. DM) still get a one-tap path
  // back to the legacy mixed view.
  const [showZapCounterparties, setShowZapCounterparties] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('messages_window_days')
      .then((v) => {
        if (v === '90') setWindowDays(90);
      })
      .catch(() => {});
    AsyncStorage.getItem('messages_show_zap_counterparties')
      .then((v) => {
        if (v === '1') setShowZapCounterparties(true);
      })
      .catch(() => {});
  }, []);

  const cycleWindowDays = useCallback(() => {
    setWindowDays((prev) => {
      const next: 30 | 90 = prev === 30 ? 90 : 30;
      AsyncStorage.setItem('messages_window_days', String(next)).catch(() => {});
      return next;
    });
  }, []);

  // Side-effect (AsyncStorage.setItem) lives OUTSIDE the functional updater. React can call updaters multiple times during a render in StrictMode/concurrent rendering, which would double-fire the setItem with the wrong value. Persist via a downstream useEffect on the state, with a ref-gate to skip the initial-mount write that would otherwise clobber the just-loaded persisted value with the default.
  const toggleShowZapCounterparties = useCallback(() => {
    setShowZapCounterparties((prev) => !prev);
  }, []);
  const showZapCounterpartiesHydrated = useRef(false);
  useEffect(() => {
    if (!showZapCounterpartiesHydrated.current) {
      showZapCounterpartiesHydrated.current = true;
      return;
    }
    AsyncStorage.setItem(
      'messages_show_zap_counterparties',
      showZapCounterparties ? '1' : '0',
    ).catch(() => {});
  }, [showZapCounterparties]);

  // Also pre-warms the friend-picker avatar bitmaps. Histograms from
  // perf-suite showed the FAB → FriendPicker open path spends most
  // of its modern-jank budget on cold avatar decode. Prefetching the
  // avatars the picker will actually display (filtered + sorted to
  // match FriendPickerSheet's friends memo, capped at 50) pushes the
  // decode cost OUT of the FAB-tap-to-content window. By the time the
  // user taps (+), `expo-image`'s disk cache is warm and the avatars
  // render without a fresh decode. See plan in #245.
  //
  // TTL gate (30 s) so the prefetch doesn't re-fire on every
  // contacts-array change — `loadContacts` updates contacts
  // incrementally as kind-0 profile batches arrive, which would
  // otherwise schedule the same 50-avatar prefetch on every drip.
  // Mirrors the same pattern used by `dmInboxLastRefreshAt`.
  const lastAvatarPrefetchAt = useRef<number>(0);
  // TTL gate for the focus-driven inbox refresh. Without it, every focus
  // (including the back-from-group transition) triggered a full
  // refreshDmInbox cached-loop on the JS thread for ~3 s on a chunky
  // inbox — perceived as MessagesScreen freezing right after the back
  // animation lands (#286 / #300). 30 s mirrors the avatar-prefetch TTL
  // below; the live `subscribeGroupMessages` channel covers delivery
  // for any wraps that arrive while the user was inside a group.
  const dmInboxLastRefreshAt = useRef<number>(0);
  const DM_INBOX_REFRESH_TTL_MS = 30_000;
  // Short TTL written on abort (#731 Fix 1 — "chaining trap").
  // The full 30 s TTL is only written when the refresh RESOLVES. If the
  // user blurs before it finishes the TTL was previously left unset,
  // so the very next focus would immediately start another full refresh
  // (tab-hop faster than the refresh → full refresh every time,
  // indefinitely). Writing a shorter marker on abort tells the next
  // focus "a refresh already started and was interrupted; wait a bit
  // before trying again" — 10 s is long enough to suppress spurious
  // re-chains without delaying a genuine user intent to view new DMs.
  const DM_INBOX_ABORT_TTL_MS = 10_000;
  // Aborts the in-flight refreshDmInbox when the user leaves Messages, so the NIP-17 unwrap loop releases the JS thread quickly instead of grinding through hundreds of cached wraps after blur. See #412 for the perceived "tabs feel locked during refresh" symptom.
  const refreshAbortRef = useRef<AbortController | null>(null);
  // Tracks the post-interaction delay timer so it can be cancelled on blur before it fires (#731 Fix 1).
  const refreshDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const newRefreshSignal = useCallback((): AbortSignal => {
    refreshAbortRef.current?.abort();
    const ctrl = new AbortController();
    refreshAbortRef.current = ctrl;
    return ctrl.signal;
  }, []);
  // Read `enforceFollowingOnly` via a ref inside the DM-refresh focus effect so the callback's deps don't include it (and don't invalidate when, in future, this might depend on contact changes too). The focus cleanup must only run on actual blur, not on every dep change, otherwise an in-flight unwrap loop would be aborted prematurely. (#413 review)
  const enforceFollowingOnlyRef = useRef(enforceFollowingOnly);
  useEffect(() => {
    enforceFollowingOnlyRef.current = enforceFollowingOnly;
  }, [enforceFollowingOnly]);

  // Force-refresh the inbox whenever the effective enforcement flips so all data-layer paths re-apply.
  useEffect(() => {
    if (!isLoggedIn) return;
    if (lastAppliedEnforceRef.current === enforceFollowingOnly) return;
    lastAppliedEnforceRef.current = enforceFollowingOnly;
    refreshDmInbox({
      force: true,
      includeNonFollows: !enforceFollowingOnly,
      signal: newRefreshSignal(),
    });
  }, [enforceFollowingOnly, isLoggedIn, refreshDmInbox, newRefreshSignal]);

  useFocusEffect(
    useCallback(() => {
      if (!isLoggedIn) return;
      // Tell NostrContext to open the live NIP-17 sub — idempotent;
      // cold-boot left it disarmed so Home stays responsive. First
      // Messages-tab focus pays the wrap-drain cost here, where a
      // brief loading state is the expected UX.
      armLiveDmSub();
      // Two-stage defer (#731 Fix 1 — keep decrypt off the tab-animation hot path):
      //
      // 1. InteractionManager.runAfterInteractions waits for the tab-bar
      //    slide animation to complete its "interaction" frame budget.
      // 2. Inside that callback a 120 ms safety margin lets the first JS
      //    paint of MessagesScreen (FlashList measure + item layout +
      //    avatar decode) finish before the decrypt loop begins. Without
      //    this delay those two phases competed for the JS thread on every
      //    cold Messages focus — visible as list-renders jank right after
      //    the tab-bar animation completes.
      //
      // Both the interactionHandle and refreshDelayRef are cancelled in
      // cleanup so a blur before the delay fires is a complete no-op —
      // no decrypt work starts at all (optimal outcome for a fast tab-hop).
      const interactionHandle = InteractionManager.runAfterInteractions(() => {
        if (Date.now() - dmInboxLastRefreshAt.current < DM_INBOX_REFRESH_TTL_MS) return;
        refreshDelayRef.current = setTimeout(() => {
          refreshDelayRef.current = null;
          const startedAt = Date.now();
          // Capture the signal: refreshDmInbox RESOLVES (never rejects) on
          // abort — it early-returns internally on `signal.aborted` — so
          // `.then` runs in BOTH the completed and aborted cases and `.catch`
          // is effectively dead for aborts. We therefore branch on the signal
          // (not the catch) to choose the TTL marker.
          const signal = newRefreshSignal();
          refreshDmInbox({
            includeNonFollows: !enforceFollowingOnlyRef.current,
            signal,
          })
            .then(() => {
              // Aborted mid-refresh (e.g. a fast tab-hop): write a shorter
              // 10 s marker (#731 Fix 1 — "chaining trap") so the next focus
              // doesn't immediately re-chain a full refresh, while still
              // refreshing sooner than a clean 30 s TTL would. A clean
              // completion gets the full 30 s TTL.
              dmInboxLastRefreshAt.current = signal.aborted
                ? Date.now() - (DM_INBOX_REFRESH_TTL_MS - DM_INBOX_ABORT_TTL_MS)
                : startedAt;
            })
            .catch(() => {
              // refreshDmInbox rarely rejects, but if it does, treat it like an
              // abort: short marker so we retry soon rather than waiting 30 s.
              dmInboxLastRefreshAt.current =
                Date.now() - (DM_INBOX_REFRESH_TTL_MS - DM_INBOX_ABORT_TTL_MS);
            });
        }, 120);
      });
      return () => {
        interactionHandle.cancel();
        // Cancel any pending delay that was scheduled inside the interaction
        // callback but hadn't fired yet (e.g. blur during the 120 ms window).
        if (refreshDelayRef.current !== null) {
          clearTimeout(refreshDelayRef.current);
          refreshDelayRef.current = null;
        }
        // Abort an in-flight unwrap loop on tab blur so the JS thread isn't busy decrypting wraps the user no longer needs to see right now. The next focus will re-trigger refresh subject to the TTL gate (30 s resolved, 10 s aborted).
        refreshAbortRef.current?.abort();
        refreshAbortRef.current = null;
      };
    }, [isLoggedIn, refreshDmInbox, newRefreshSignal, armLiveDmSub]),
  );

  // Avatar prefetch is split into its own focus effect so it can depend on `contacts` (the content it iterates) without invalidating the DM-refresh callback above. (#413 review)
  useFocusEffect(
    useCallback(() => {
      if (!isLoggedIn) return;
      const handle = InteractionManager.runAfterInteractions(() => {
        const PREFETCH_TTL_MS = 30_000;
        if (Date.now() - lastAvatarPrefetchAt.current < PREFETCH_TTL_MS) return;

        // Match FriendPickerSheet's `friends` memo: drop entries with no resolved name (the picker hides them), sort by first Latin letter then by lower-case name, then take the first 50. That's the set the user will see in the initial sheet viewport — prefetching them is the relevant warm-up.
        //
        // firstAlpha mirrors FriendPickerSheet's local helper: NFKD-normalise + uppercase, return first [A-Z] char or '#'.
        const firstAlpha = (n: string): string => {
          const m = n.normalize('NFKD').toUpperCase().match(/[A-Z]/);
          return m ? m[0] : '#';
        };
        const named: { picture: string; fa: string; lc: string }[] = [];
        for (const c of contacts) {
          const name = (c.profile?.displayName || c.profile?.name || c.petname || '').trim();
          const picture = c.profile?.picture;
          if (!name || !picture) continue;
          named.push({ picture, fa: firstAlpha(name), lc: name.toLowerCase() });
        }
        named.sort((a, b) => {
          if (a.fa !== b.fa) return a.fa.localeCompare(b.fa);
          return a.lc.localeCompare(b.lc);
        });
        const avatarUrls = named.slice(0, 50).map((x) => x.picture);

        if (avatarUrls.length === 0) return;

        lastAvatarPrefetchAt.current = Date.now();
        ExpoImage.prefetch(avatarUrls, 'memory-disk').catch(() => {
          // Prefetch failures are silent — falls back to on-demand decode at sheet open time, the un-fixed behaviour. No user-visible regression.
        });
      });
      return () => handle.cancel();
    }, [isLoggedIn, contacts]),
  );

  // Trust gate (#547). For 'friends' tier this is L1 follows + viewer + seeds;
  // for 'fof' it adds L2 follows-of-follows; for 'all' it's still computed
  // but the enforceFollowingOnly switch above disables the gate entirely.
  // Kept named `followPubkeys` so the downstream call-sites stay diff-clean
  // — the *semantics* widened from "raw follow list" to "tier-aware trust
  // set" but every existing predicate (Set.has) still applies unchanged.
  const followPubkeys = trustSetForTier(effectiveWotTier);

  // Single pubkey → ContactInfo lookup for the screen, shared by every
  // row + handler. Three previously-separate `contacts.find()` paths
  // (GroupAvatar's avatar cluster, GroupRow's sender-name preview, and
  // handleConversationPress's picture/lightning-address fallback) now
  // all consult this map, so a 50-contact x N-row screen does O(contacts)
  // once per render instead of O(rows × contacts) per render. See #245.
  // Non-followed DM senders aren't in `contacts`, so the contacts pipeline
  // never fetches their kind-0 — they'd show a raw npub + blank avatar. We
  // fetch their profiles on demand (see the effect below), cache to disk, and
  // layer them into the resolution here + buildDmSummaries (#664).
  const [nonFollowProfiles, setNonFollowProfiles] = useState<Map<string, NostrProfile>>(new Map());
  const nonFollowAttempted = useRef<Set<string>>(new Set());

  // Hydrate the per-account non-follow profile cache on mount / identity change.
  useEffect(() => {
    // Reset per-account state first so a previous account's profiles + the
    // attempted set don't leak across a multi-account switch (#668 review).
    nonFollowAttempted.current = new Set();
    setNonFollowProfiles(new Map());
    if (!pubkey) return;
    let cancelled = false;
    AsyncStorage.getItem(`nonfollow_profiles_${pubkey}`)
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          const obj = JSON.parse(raw) as Record<string, NostrProfile>;
          setNonFollowProfiles(new Map(Object.entries(obj)));
        } catch {
          // Corrupt cache — ignore; the fetch effect repopulates.
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pubkey]);

  const contactInfoMap = useMemo(() => {
    const map = new Map<string, ContactInfo>();
    for (const c of contacts) {
      map.set(c.pubkey.toLowerCase(), {
        picture: c.profile?.picture ?? null,
        name: (c.profile?.displayName || c.profile?.name || c.petname || '').trim() || null,
        lightningAddress: c.profile?.lud16 ?? null,
      });
    }
    // Layer in non-followed senders' fetched profiles (never override a contact).
    for (const [pk, prof] of nonFollowProfiles) {
      if (map.has(pk)) continue;
      map.set(pk, {
        picture: prof.picture ?? null,
        name: (prof.displayName || prof.name || '').trim() || null,
        lightningAddress: prof.lud16 ?? null,
      });
    }
    return map;
  }, [contacts, nonFollowProfiles]);

  // Fetch kind-0 for DM partners not in contacts and not yet cached, so their
  // name + avatar resolve in the list (esp. with WoT: All). Each pubkey is
  // attempted once per session so a profile-less sender isn't re-queried (#664).
  useEffect(() => {
    if (!pubkey) return;
    // De-dupe — dmInbox can hold multiple entries for the same partner.
    const missingSet = new Set<string>();
    for (const entry of dmInbox) {
      const pk = entry.partnerPubkey?.toLowerCase();
      if (!pk || contactInfoMap.has(pk) || nonFollowAttempted.current.has(pk)) continue;
      missingSet.add(pk);
    }
    if (missingSet.size === 0) return;
    const missing = [...missingSet];
    missing.forEach((pk) => nonFollowAttempted.current.add(pk));
    let cancelled = false;
    fetchProfilesForPubkeys(missing)
      .then((fetched) => {
        if (cancelled || fetched.size === 0) return;
        // No side effects in the updater (Strict Mode may run it twice);
        // persistence is handled by the dedicated effect below.
        setNonFollowProfiles((prev) => {
          const next = new Map(prev);
          for (const [pk, prof] of fetched) next.set(pk.toLowerCase(), prof);
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dmInbox, contactInfoMap, pubkey, fetchProfilesForPubkeys]);

  // Persist the non-follow profile cache when it changes — kept out of the
  // state updater so Strict Mode's double-invocation can't duplicate the write.
  useEffect(() => {
    if (!pubkey || nonFollowProfiles.size === 0) return;
    AsyncStorage.setItem(
      `nonfollow_profiles_${pubkey}`,
      JSON.stringify(Object.fromEntries(nonFollowProfiles)),
    ).catch(() => {});
  }, [nonFollowProfiles, pubkey]);

  // useDeferredValue lets React deprioritise the (O(n)) summary rebuild when an urgent update — e.g. a tab-bar tap, scroll gesture — comes in during a relay-burst flush. The user's tap renders against the previous dmInbox; the new summary lands on the next idle frame. Keeps the bottom nav snappy when 25 wraps batch-flush via the live-sub queue (queueInboxEntry / flushPendingInbox).
  const deferredDmInbox = useDeferredValue(dmInbox);
  const deferredContacts = useDeferredValue(contacts);
  // Build the DM summaries first — this is always part of the inbox
  // regardless of the zap-counterparties toggle. Pass the tier-aware
  // trust set (#547) as a defence-in-depth filter. NostrContext's
  // refreshDmInbox already drops non-trusted senders at the data layer,
  // but applying it again here guards against stale dmInbox state from
  // before a follow was revoked or a tier was widened. The trust rule
  // is load-bearing — keep it enforced everywhere a summary is built.
  // Skip the gate only when effectiveWotTier === 'all' (which itself is
  // already secret-mode-gated by GroupsContext's hard-lock).
  const dmSummaries = useMemo(() => {
    return buildDmSummaries(
      deferredDmInbox,
      deferredContacts,
      enforceFollowingOnly ? followPubkeys : undefined,
      nonFollowProfiles,
    );
  }, [deferredDmInbox, deferredContacts, enforceFollowingOnly, followPubkeys, nonFollowProfiles]);
  // Build the zap-counterparties memo separately so that toggling
  // `showZapCounterparties` off doesn't make every wallet update churn
  // the merged summary list — when the toggle is off this memo is built
  // once but never consumed (cheap O(wallets) that beats the alternative
  // of unioning on every render).
  const zapSummaries = useMemo(() => {
    if (!showZapCounterparties) return null;
    return buildConversationSummaries(wallets, deferredContacts);
  }, [wallets, deferredContacts, showZapCounterparties]);
  const conversationSummaries = useMemo(() => {
    // #147: by default the inbox shows DMs only — zap-only counterparties (rows derived purely from wallet zap history with no decoded NIP-04/NIP-17 message) are hidden. The "Show zap counterparties" chip re-unions them when the user opts in.
    if (!zapSummaries) return dmSummaries;
    return mergeSummaries(zapSummaries, dmSummaries);
  }, [dmSummaries, zapSummaries]);

  // The trust gate is on by default (parental-control requirement);
  // enforcement lives inside buildDmSummaries + refreshDmInbox. This memo
  // applies the user-selectable time window + search, plus a defensive
  // trust check for pubkey'd zap rows so untrusted zap counterparties
  // don't slip in. Groups go through their own trust gate inside
  // GroupsContext.visibleGroups, so we just merge the result here.
  type InboxRow =
    | { kind: 'dm'; summary: ConversationSummary; sortKey: number }
    | { kind: 'group'; summary: GroupSummary; sortKey: number };

  const filteredRows = useMemo<InboxRow[]>(() => {
    const cutoff = Math.floor(Date.now() / 1000) - windowDays * 86400;
    const lower = search.trim().toLowerCase();

    const dmRows: InboxRow[] = conversationSummaries
      .filter((s) => {
        if (s.lastActivityAt < cutoff) return false;
        // Defence-in-depth trust gate (#547): apply the tier-aware trust set
        // unless the effective tier is 'all'. effectiveWotTier already
        // collapses 'all' → 'friends' for non-secret-mode users, so the
        // parental-control hard-lock holds even with a stale persisted 'all'.
        if (enforceFollowingOnly && s.pubkey && !followPubkeys.has(s.pubkey.toLowerCase()))
          return false;
        if (!lower) return true;
        return (
          s.name.toLowerCase().includes(lower) ||
          conversationPreview(s).toLowerCase().includes(lower)
        );
      })
      .map((s) => ({ kind: 'dm', summary: s, sortKey: s.lastActivityAt }));

    const groupRows: InboxRow[] = groupSummaries
      .filter((g) => {
        if (g.activity.lastActivityAt < cutoff) return false;
        if (!lower) return true;
        return (
          g.group.name.toLowerCase().includes(lower) ||
          g.activity.lastText.toLowerCase().includes(lower)
        );
      })
      .map((g) => ({ kind: 'group', summary: g, sortKey: g.activity.lastActivityAt }));

    return [...dmRows, ...groupRows].sort((a, b) => b.sortKey - a.sortKey);
  }, [
    conversationSummaries,
    groupSummaries,
    search,
    followPubkeys,
    enforceFollowingOnly,
    windowDays,
  ]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    // Pull-to-refresh is explicit user intent — force-bypass the 24h
    // own-profile cache so renames published elsewhere surface now,
    // and also bypass the 30s DM-inbox TTL so the relay query actually
    // runs (the TTL's default path is for useFocusEffect tab bounces).
    //
    // Important: `refreshContacts` must complete BEFORE
    // `refreshDmInbox`. The DM refresh filters by the logged-in user's
    // current follow set, and if we run them in parallel the DM query
    // captures the stale closure before the new contacts state lands,
    // so any new-since-last-refresh followers' messages get dropped
    // by the follow gate. Profile refresh is independent and can run
    // in parallel.
    //
    // try/finally so a relay timeout / decrypt throw doesn't leave the
    // UI stuck in the "refreshing" spinner state.
    try {
      await Promise.all([refreshContacts(), refreshProfile({ force: true })]);
      // Pull-to-refresh deliberately does NOT call newRefreshSignal() here. If a focus refresh is already in flight, refreshDmInbox's single-flight guard returns the existing promise; aborting that promise via newRefreshSignal() then awaiting it would resolve to AbortError and never start a fresh refresh — making pull-to-refresh a no-op whenever a focus refresh was running. We let the in-flight one finish (its result is what the user wants anyway) and only kick off a new refresh if none is running. The focus-effect signal still aborts on blur, which covers the original snappiness goal. (#413 review)
      await refreshDmInbox({
        force: true,
        includeNonFollows: !enforceFollowingOnly,
      });
    } catch (err) {
      // AbortError is expected when the user navigates away mid-refresh (the focus-effect signal fires) — swallow silently and let the next focus re-trigger as needed. Other errors bubble through; the finally block still resets the spinner.
      if ((err as Error)?.name !== 'AbortError') throw err;
    } finally {
      setRefreshing(false);
    }
  }, [refreshContacts, refreshDmInbox, refreshProfile, enforceFollowingOnly]);

  const handleConversationPress = useCallback(
    (summary: ConversationSummary) => {
      const info = summary.pubkey ? contactInfoMap.get(summary.pubkey.toLowerCase()) : undefined;
      const picture = summary.picture ?? info?.picture ?? null;
      const lightningAddress = summary.lightningAddress ?? info?.lightningAddress ?? null;
      if (summary.pubkey) {
        navigation.navigate('Conversation', {
          pubkey: summary.pubkey,
          name: summary.name,
          picture,
          lightningAddress,
        });
        return;
      }
      // Anonymous zap: no pubkey to thread against. Surface what we have via
      // the bottom-sheet peek instead of straight to the full profile — the
      // sheet's "View full profile" link drills in if the user wants the
      // wider view; staying as a peek matches every other contact-tap entry
      // point in the app.
      setSheetContact({
        pubkey: null,
        name: summary.name,
        picture,
        banner: null,
        nip05: summary.nip05,
        lightningAddress,
        source: 'nostr',
      });
      setProfileSheetVisible(true);
    },
    [contactInfoMap, navigation],
  );

  const handleStartConversation = useCallback(() => {
    setPickerVisible(true);
  }, []);

  const handlePickerSelect = useCallback(
    (friend: PickedFriend) => {
      setPickerVisible(false);
      navigation.navigate('Conversation', {
        pubkey: friend.pubkey,
        name: friend.name,
        picture: friend.picture,
        lightningAddress: friend.lightningAddress,
      });
    },
    [navigation],
  );

  const handleGroupPress = useCallback(
    (g: GroupSummary) => {
      navigation.navigate('GroupConversation', { groupId: g.group.id });
    },
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: InboxRow }) => {
      // Pass the parent handler reference directly (stable across renders)
      // and let ConversationRow / GroupRow bind the row's summary into the
      // press callback at the leaf. Previously we passed an inline arrow
      // (`() => handleX(item.summary)`) which was a fresh reference per
      // render and defeated the row's React.memo. (#300 follow-up.)
      if (item.kind === 'dm') {
        return <ConversationRow summary={item.summary} onPress={handleConversationPress} />;
      }
      return (
        <GroupRow
          summary={item.summary}
          onPress={handleGroupPress}
          contactInfoMap={contactInfoMap}
        />
      );
    },
    [handleConversationPress, handleGroupPress, contactInfoMap],
  );

  // Auto-scroll to top when a new top row arrives via the live DM sub, but only if the user is already near the top so anyone scrolled down reading older threads isn't interrupted.
  const listRef = useRef<FlashListRef<InboxRow>>(null);
  const scrollOffsetRef = useRef(0);
  const prevTopIdRef = useRef<string | null>(null);
  const NEAR_TOP_PX = 200;
  const handleListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
  }, []);
  useEffect(() => {
    const top = filteredRows[0];
    const topId = top
      ? top.kind === 'dm'
        ? `dm:${top.summary.id}`
        : `group:${top.summary.group.id}`
      : null;
    // Skip the initial mount — only scroll on a *change* of top row, not the first paint.
    if (
      topId &&
      prevTopIdRef.current !== null &&
      topId !== prevTopIdRef.current &&
      scrollOffsetRef.current < NEAR_TOP_PX
    ) {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    }
    prevTopIdRef.current = topId;
  }, [filteredRows]);

  return (
    <View style={styles.container}>
      <TabBackgroundImage style={styles.bgImage} />
      <TabHeader title="Messages" icon={<MessageCircle size={20} color={colors.brandPink} />} />
      <View style={styles.headerExtras}>
        <View style={styles.chipRow}>
          {searchExpanded ? (
            <View style={styles.searchRow}>
              <Search size={16} color="rgba(255,255,255,0.7)" strokeWidth={2} />
              <TextInput
                ref={searchInputRef}
                style={styles.searchInput}
                placeholder="Search conversations..."
                placeholderTextColor="rgba(255,255,255,0.5)"
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Search conversations"
                testID="messages-search-input"
              />
              <TouchableOpacity
                onPress={() => {
                  setSearch('');
                  setSearchExpanded(false);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Close search"
                testID="messages-close-search"
              >
                <X size={16} color="rgba(255,255,255,0.8)" strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={{ flex: 1 }} />
              <TouchableOpacity
                style={styles.searchToggle}
                onPress={() => {
                  setSearchExpanded(true);
                  setTimeout(() => searchInputRef.current?.focus(), 100);
                }}
                accessibilityLabel="Search conversations"
                testID="messages-search-toggle"
              >
                <Search size={18} color="rgba(255,255,255,0.8)" strokeWidth={2} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      <View style={styles.content}>
        {isLoggedIn && (
          <View style={styles.filterChipRow}>
            <WebOfTrustChip
              currentTier={effectiveWotTier}
              onPress={() => setWotSheetVisible(true)}
              testID="messages-wot-chip"
            />
            {/* Hidden marker for Maestro so flows can assert the active tier without parsing the chip label. Mirrors messages-zaps-toggle-on/off below. */}
            <View testID={`messages-wot-tier-${effectiveWotTier}`} accessibilityElementsHidden />

            <TouchableOpacity
              style={styles.filterChipInteractive}
              onPress={cycleWindowDays}
              accessibilityLabel={`Window: last ${windowDays} days. Tap to change.`}
              accessibilityRole="button"
              testID="messages-window-toggle"
            >
              <Clock size={14} color={colors.brandPink} />
              <Text style={styles.filterChipText}>Last {windowDays} days</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={
                showZapCounterparties
                  ? styles.filterChipInteractiveOn
                  : styles.filterChipInteractive
              }
              onPress={toggleShowZapCounterparties}
              accessibilityLabel={
                showZapCounterparties
                  ? 'Hide zap counterparties from the inbox'
                  : 'Show zap counterparties in the inbox'
              }
              accessibilityRole="button"
              accessibilityState={{ selected: showZapCounterparties }}
              testID="messages-zaps-toggle"
            >
              <Zap size={14} color={colors.brandPink} />
              <Text style={styles.filterChipText}>Zaps</Text>
            </TouchableOpacity>
            {/* Hidden marker so Maestro can assert WHICH state the toggle is in (chip is always visible regardless), without relying on accessibilityState which RN exposes inconsistently across Android versions. */}
            <View
              testID={`messages-zaps-toggle-${showZapCounterparties ? 'on' : 'off'}`}
              accessibilityElementsHidden
            />
          </View>
        )}
        {!isLoggedIn ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Connect Nostr</Text>
            <Text style={styles.emptySubtitle}>
              Connect your Nostr identity to see your conversations here.
            </Text>
            <TouchableOpacity
              style={styles.connectButton}
              onPress={() => navigation.getParent()?.dispatch({ type: 'OPEN_DRAWER' })}
            >
              <Text style={styles.connectButtonText}>Go to Account</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlashList
            ref={listRef}
            data={filteredRows}
            keyExtractor={(item) =>
              item.kind === 'dm' ? `dm:${item.summary.id}` : `group:${item.summary.group.id}`
            }
            renderItem={renderItem}
            onScroll={handleListScroll}
            scrollEventThrottle={16}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>
                  {search ? 'No matches' : 'No conversations yet'}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {search ? 'Try a different search term.' : 'Zap a friend or tap + to start one.'}
                </Text>
              </View>
            }
            contentContainerStyle={styles.listContent}
          />
        )}

        {isLoggedIn && (
          <TouchableOpacity
            style={styles.fab}
            onPress={handleStartConversation}
            accessibilityLabel="Start new conversation"
            testID="start-conversation-button"
            activeOpacity={0.85}
          >
            <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
              <Path d="M12 5v14M5 12h14" stroke="#FFFFFF" strokeWidth={2.5} strokeLinecap="round" />
            </Svg>
          </TouchableOpacity>
        )}
      </View>

      <FriendPickerSheet
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={handlePickerSelect}
        title="Start a conversation"
        onNewGroup={() => {
          setPickerVisible(false);
          setCreateGroupVisible(true);
        }}
      />

      <CreateGroupSheet
        visible={createGroupVisible}
        onClose={() => setCreateGroupVisible(false)}
        onCreated={(group) => {
          setCreateGroupVisible(false);
          navigation.navigate('GroupConversation', { groupId: group.id });
        }}
      />

      <ContactProfileSheet
        visible={profileSheetVisible}
        onClose={() => setProfileSheetVisible(false)}
        contact={sheetContact}
        onViewFullProfile={() => {
          if (!sheetContact) return;
          setProfileSheetVisible(false);
          navigation.navigate('ContactProfile', { contact: sheetContact });
        }}
      />

      <WebOfTrustBottomSheet visible={wotSheetVisible} onClose={() => setWotSheetVisible(false)} />
    </View>
  );
};

export default MessagesScreen;
