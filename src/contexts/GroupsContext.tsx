import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Group, GroupActivity, GroupSummary } from '../types/groups';
import { createGroupId, loadGroups, saveGroups } from '../services/groupsStorageService';
import { setKnownGroups } from '../services/groupRoutingRegistry';
import { loadGroupMessages } from '../services/groupMessagesStorageService';
import { useNostr, subscribeGroupMessages } from './NostrContext';
import {
  DEFAULT_RELAYS,
  GROUP_STATE_KIND,
  subscribeGroupStateForViewer,
} from '../services/nostrService';

const FOLLOWING_ONLY_KEY = 'groups_following_only';

interface GroupsContextType {
  groups: Group[];
  /**
   * Groups filtered by the friend-graph "Following only" rule plus the
   * (dev-mode-only) user toggle. This is what GroupsScreen renders by
   * default — see `followingOnly` / `setFollowingOnly`.
   */
  visibleGroups: Group[];
  /**
   * If true, only groups that include at least one OTHER member from the
   * current user's follow list are shown. Default true; in dev_mode the
   * user can toggle it off via the chip on GroupsScreen.
   */
  followingOnly: boolean;
  setFollowingOnly: (next: boolean) => void;
  /** Mirrors AsyncStorage `dev_mode`. Controls whether the chip is interactive. */
  devMode: boolean;
  loading: boolean;
  createGroup: (name: string, memberPubkeys: string[]) => Promise<Group>;
  renameGroup: (groupId: string, newName: string) => Promise<boolean>;
  deleteGroup: (groupId: string) => Promise<void>;
  getGroup: (groupId: string) => Group | undefined;
  /**
   * Reconcile a kind-30200 group-state event into local state. Returns
   * true if a change was applied. Caller is responsible for filtering by
   * sender (we trust whatever the subscriber feeds in).
   */
  reconcileFromGroupStateEvent: (input: {
    senderPubkey: string;
    groupId: string;
    name: string;
    memberPubkeys: string[];
    createdAt: number;
  }) => Promise<boolean>;
  /**
   * `visibleGroups` joined with their per-group activity (last message,
   * recent senders), sorted newest-first. This is what the Messages tab
   * renders so groups appear inline with 1:1 DMs.
   */
  groupSummaries: GroupSummary[];
}

const RECENT_SENDERS_CAP = 3;

function computeRecentSenders(messages: { senderPubkey: string; createdAt: number }[]): string[] {
  // Walk newest-first, dedup by pubkey, take up to N. Storage already
  // sorts by createdAt asc, so iterate from the tail.
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = messages.length - 1; i >= 0 && out.length < RECENT_SENDERS_CAP; i--) {
    const pk = messages[i].senderPubkey.toLowerCase();
    if (seen.has(pk)) continue;
    seen.add(pk);
    out.push(pk);
  }
  return out;
}

function activityFromMessages(
  group: Group,
  messages: { senderPubkey: string; text: string; createdAt: number }[],
): GroupActivity {
  const groupCreatedAtSec = Math.floor(group.createdAt / 1000);
  if (messages.length === 0) {
    return {
      lastActivityAt: groupCreatedAtSec,
      lastText: '',
      lastSenderPubkey: null,
      recentSenderPubkeys: [],
    };
  }
  const last = messages[messages.length - 1];
  // Math.max guards against the (rare) case where a relay returns a
  // message with `createdAt` earlier than the local group's
  // `createdAt` — clock skew or an event back-dated via NIP-59 wrap
  // randomisation. Honours the docstring invariant in
  // `types/groups.ts:GroupActivity.lastActivityAt`.
  return {
    lastActivityAt: Math.max(last.createdAt, groupCreatedAtSec),
    lastText: last.text,
    lastSenderPubkey: last.senderPubkey.toLowerCase(),
    recentSenderPubkeys: computeRecentSenders(messages),
  };
}

const GroupsContext = createContext<GroupsContextType | undefined>(undefined);

export const GroupsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [followingOnly, setFollowingOnlyState] = useState(true);
  const [devMode, setDevMode] = useState(false);
  // Per-group activity rollup (last message + recent senders). Populated
  // on mount from AsyncStorage and kept fresh by the inbound-message
  // listener below + a local hook from GroupConversationScreen sends.
  const [activityByGroup, setActivityByGroup] = useState<Record<string, GroupActivity>>({});
  const { publishGroupState, pubkey, relays, isLoggedIn, contacts } = useNostr();
  // Track the latest reconciler in a ref so the subscription effect can
  // call it without re-subscribing on every group state change.
  const reconcilerRef = useRef<
    | ((input: {
        senderPubkey: string;
        groupId: string;
        name: string;
        memberPubkeys: string[];
        createdAt: number;
      }) => Promise<boolean>)
    | null
  >(null);

  useEffect(() => {
    loadGroups()
      .then((loaded) => setGroups(loaded))
      .finally(() => setLoading(false));
  }, []);

  // Load persisted user preferences for the chip + dev-mode escape hatch.
  // dev_mode is shared with AboutScreen's hidden-tap unlock so the same
  // override surfaces across the app.
  useEffect(() => {
    AsyncStorage.getItem(FOLLOWING_ONLY_KEY).then((v) => {
      // Default ON; only flip OFF if the user explicitly persisted false.
      if (v === 'false') setFollowingOnlyState(false);
    });
    AsyncStorage.getItem('dev_mode').then((v) => setDevMode(v === 'true'));
  }, []);

  const setFollowingOnly = useCallback((next: boolean) => {
    setFollowingOnlyState(next);
    AsyncStorage.setItem(FOLLOWING_ONLY_KEY, next ? 'true' : 'false').catch(() => {});
  }, []);

  // Keep the module-level routing registry in lock-step with React state
  // so NostrContext's NIP-17 decrypt loop can resolve which group an
  // inbound rumor belongs to without going through context.
  useEffect(() => {
    setKnownGroups(groups);
  }, [groups]);

  // Populate activity for any group we don't yet have a rollup for. Runs
  // after the initial loadGroups() resolves and again whenever a new
  // group is created/reconciled. We only load groups whose key isn't in
  // the map yet, so this stays cheap on subsequent renders.
  useEffect(() => {
    let cancelled = false;
    const missing = groups.filter((g) => !activityByGroup[g.id]);
    if (missing.length === 0) return;
    (async () => {
      const updates: Record<string, GroupActivity> = {};
      for (const g of missing) {
        const msgs = await loadGroupMessages(g.id);
        updates[g.id] = activityFromMessages(g, msgs);
      }
      if (!cancelled && Object.keys(updates).length > 0) {
        setActivityByGroup((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groups, activityByGroup]);

  // Inbound group messages are persisted by NostrContext's NIP-17 routing
  // loop; we just need to refresh the activity rollup for the affected
  // group so the Messages tab re-sorts. The listener fires after the
  // append, so a fresh load reflects the new tail.
  useEffect(() => {
    const unsub = subscribeGroupMessages((groupId) => {
      const g = groups.find((x) => x.id === groupId);
      if (!g) return;
      loadGroupMessages(groupId).then((msgs) => {
        setActivityByGroup((prev) => ({ ...prev, [groupId]: activityFromMessages(g, msgs) }));
      });
    });
    return unsub;
  }, [groups]);

  const followPubkeys = useMemo(() => {
    const set = new Set<string>();
    for (const c of contacts) set.add(c.pubkey.toLowerCase());
    return set;
  }, [contacts]);

  // Anti-spam: a group is visible only if at least one OTHER member is
  // in the viewer's follow list. Mirrors the 1:1 "Following only" rule
  // at MessagesScreen.tsx:128-143. Locked-on outside dev_mode; in
  // dev_mode the user can flip it via the chip on GroupsScreen.
  const visibleGroups = useMemo(() => {
    const enforce = followingOnly || !devMode;
    if (!enforce) return groups;
    return groups.filter((g) => g.memberPubkeys.some((pk) => followPubkeys.has(pk.toLowerCase())));
  }, [groups, followPubkeys, followingOnly, devMode]);

  // Synchronous mirror of the `groups` state used as the read source
  // for `persist` so concurrent mutators serialise correctly without
  // depending on React's setState batching/timing.
  //
  // Why this exists: the earlier "compute inside setGroups callback"
  // pattern still raced because the `await saveGroups(after)` line
  // could resolve before React processed the queued setter (in
  // unbatched async paths the setter runs synchronously, but in
  // batched paths it runs at flush time — so `after` could still hold
  // its initial `[]` when the AsyncStorage write started). Reading +
  // writing this ref synchronously inside `persist` guarantees that
  // (a) the next concurrent caller sees the latest committed mutation
  // immediately, and (b) `saveGroups` always serialises the post-
  // mutation array.
  const groupsRef = useRef<Group[]>([]);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  const persist = useCallback(async (mutate: (curr: Group[]) => Group[]): Promise<Group[]> => {
    const after = mutate(groupsRef.current);
    // Update the ref BEFORE setGroups so a concurrent caller scheduled
    // immediately after this one reads the fresh array — otherwise
    // both callers' mutates would run against the same `curr` and the
    // second's write would clobber the first's.
    groupsRef.current = after;
    setGroups(after);
    await saveGroups(after);
    return after;
  }, []);

  const createGroup = useCallback(
    async (name: string, memberPubkeys: string[]): Promise<Group> => {
      const now = Date.now();
      const group: Group = {
        id: createGroupId(),
        name: name.trim(),
        memberPubkeys: [...new Set(memberPubkeys)],
        createdAt: now,
        updatedAt: now,
      };
      await persist((curr) => [group, ...curr]);
      // Best-effort: publish the kind-30200 group-state event so other
      // members can pick the group up. Failures are non-fatal — local
      // state is the source of truth, and we'll re-publish on rename.
      publishGroupState({
        groupId: group.id,
        name: group.name,
        memberPubkeys: group.memberPubkeys,
      }).catch((e) => {
        if (__DEV__) console.warn('[Groups] publishGroupState (create) failed:', e);
      });
      return group;
    },
    [persist, publishGroupState],
  );

  const renameGroup = useCallback(
    async (groupId: string, newName: string): Promise<boolean> => {
      const trimmed = newName.trim();
      if (!trimmed) return false;
      let updated: Group | null = null;
      await persist((curr) => {
        const idx = curr.findIndex((g) => g.id === groupId);
        if (idx === -1) return curr;
        updated = { ...curr[idx], name: trimmed, updatedAt: Date.now() };
        const next = [...curr];
        next[idx] = updated;
        return next;
      });
      if (!updated) return false;
      const finalUpdated: Group = updated;
      publishGroupState({
        groupId: finalUpdated.id,
        name: finalUpdated.name,
        memberPubkeys: finalUpdated.memberPubkeys,
      }).catch((e) => {
        if (__DEV__) console.warn('[Groups] publishGroupState (rename) failed:', e);
      });
      return true;
    },
    [persist, publishGroupState],
  );

  const deleteGroup = useCallback(
    async (groupId: string): Promise<void> => {
      await persist((curr) => curr.filter((g) => g.id !== groupId));
    },
    [persist],
  );

  const getGroup = useCallback(
    (groupId: string): Group | undefined => groups.find((g) => g.id === groupId),
    [groups],
  );

  const reconcileFromGroupStateEvent = useCallback(
    async (input: {
      senderPubkey: string;
      groupId: string;
      name: string;
      memberPubkeys: string[];
      createdAt: number;
    }): Promise<boolean> => {
      // Look up by id; if missing, create from the event. createdAt on
      // the event is in seconds (nostr convention); local state uses ms.
      const evMs = input.createdAt * 1000;
      const senderLc = input.senderPubkey.toLowerCase();
      // Read+write inside the persist mutation so we always see the
      // committed state (avoids racing concurrent createGroup/reconcile).
      let applied = false;
      await persist((curr) => {
        const idx = curr.findIndex((g) => g.id === input.groupId);
        if (idx === -1) {
          // New group: persist regardless of friend-graph here. Anti-spam
          // is enforced at *render time* by the `visibleGroups` filter
          // (which requires at least one OTHER member to be followed).
          // Doing the check at render time means we don't have to race
          // the contact-list refresh — kind:30200 events frequently land
          // BEFORE the kind:3 fetch that populates `followPubkeys`, so a
          // strict drop here loses real groups to a transient empty
          // follow set. Storage cost is bounded by the relay subscription
          // (`#p`-tagged at the viewer) so a spammer can only inflate
          // disk if they specifically address the viewer.
          const group: Group = {
            id: input.groupId,
            name: input.name,
            memberPubkeys: [...new Set(input.memberPubkeys)],
            createdAt: evMs,
            updatedAt: evMs,
          };
          applied = true;
          return [group, ...curr];
        }
        // Conflict-resolution: only apply if the incoming event is
        // newer than what we have locally.
        const existing = curr[idx];
        if (evMs <= existing.updatedAt) return curr;
        // Creator-trust gate for updates: only accept renames/membership
        // changes from publishers already in the local member set OR from
        // the viewer themselves (cross-device sync — viewer.pubkey is
        // intentionally absent from `existing.memberPubkeys` because the
        // member-list excludes self by convention). Prevents a non-member
        // from hijacking a group's name on the viewer's device.
        const trustedPublishers = new Set(existing.memberPubkeys.map((pk) => pk.toLowerCase()));
        if (pubkey) trustedPublishers.add(pubkey.toLowerCase());
        if (!trustedPublishers.has(senderLc)) {
          if (__DEV__) {
            console.log(
              `[Groups] dropping update to ${input.groupId} from non-member ${senderLc.slice(0, 8)}...`,
            );
          }
          return curr;
        }
        const updated: Group = {
          ...existing,
          name: input.name,
          memberPubkeys: [...new Set(input.memberPubkeys)],
          updatedAt: evMs,
        };
        const next = [...curr];
        next[idx] = updated;
        applied = true;
        return next;
      });
      return applied;
    },
    [persist, pubkey],
  );

  // Keep the reconciler ref pointing at the latest closure.
  useEffect(() => {
    reconcilerRef.current = reconcileFromGroupStateEvent;
  }, [reconcileFromGroupStateEvent]);

  // Subscribe to inbound kind-30200 events that p-tag the current viewer
  // so that groups created by other members appear automatically. Filters
  // by `event.kind === GROUP_STATE_KIND` defensively even though the
  // filter already constrains it.
  useEffect(() => {
    if (!isLoggedIn || !pubkey) return;
    const readRelays = relays.filter((r) => r.read).map((r) => r.url);
    const targetRelays = Array.from(new Set([...readRelays, ...DEFAULT_RELAYS]));
    const unsubscribe = subscribeGroupStateForViewer({
      viewerPubkey: pubkey,
      relays: targetRelays,
      onEvent: (ev) => {
        if (ev.kind !== GROUP_STATE_KIND) return;
        const dTag = ev.tags.find((t) => t[0] === 'd')?.[1];
        const nameTag = ev.tags.find((t) => t[0] === 'name')?.[1];
        if (!dTag || !nameTag) return;
        // Validate every p-tag value as a 64-hex pubkey before
        // reconciling — a malformed/malicious 30200 (e.g. relays
        // returning corrupted tags, or a spammer publishing junk)
        // could otherwise persist invalid strings into local member
        // lists and break NIP-17 wrap construction on subsequent
        // sends. The sender is also validated by the same regex —
        // ev.pubkey from a verified event is always 64-hex, but be
        // defensive in case the verifier ever changes.
        const HEX64 = /^[0-9a-f]{64}$/i;
        const memberPubkeys = ev.tags
          .filter((t): t is [string, string] => t[0] === 'p' && typeof t[1] === 'string')
          .map((t) => t[1].toLowerCase())
          .filter((pk) => HEX64.test(pk));
        // Include the sender (creator) plus all p-tagged members. The
        // creator is implicit per the spec — they sign the event.
        const senderLc = ev.pubkey.toLowerCase();
        if (!HEX64.test(senderLc)) return;
        const allMembers = Array.from(new Set([senderLc, ...memberPubkeys])).filter(
          (pk) => pk !== pubkey.toLowerCase(),
        );
        reconcilerRef
          .current?.({
            senderPubkey: ev.pubkey.toLowerCase(),
            groupId: dTag,
            name: nameTag,
            memberPubkeys: allMembers,
            createdAt: ev.created_at,
          })
          .catch((e) => {
            if (__DEV__) console.warn('[Groups] reconcile from event failed:', e);
          });
      },
    });
    return unsubscribe;
  }, [isLoggedIn, pubkey, relays]);

  // Join visibleGroups × activity. Groups that haven't loaded yet get a
  // placeholder activity (createdAt-based) so they still render without
  // shifting position once the load resolves.
  const groupSummaries = useMemo<GroupSummary[]>(() => {
    const list = visibleGroups.map((g) => ({
      group: g,
      activity:
        activityByGroup[g.id] ??
        ({
          lastActivityAt: Math.floor(g.createdAt / 1000),
          lastText: '',
          lastSenderPubkey: null,
          recentSenderPubkeys: [],
        } satisfies GroupActivity),
    }));
    return list.sort((a, b) => b.activity.lastActivityAt - a.activity.lastActivityAt);
  }, [visibleGroups, activityByGroup]);

  // Stable context value — see WalletContext for the same pattern + #243
  // for the symptom catalogue (dropped keystrokes, cursor jumps, lag)
  // that an unstable Provider value caused via cascading re-renders.
  const contextValue = useMemo(
    () => ({
      groups,
      visibleGroups,
      followingOnly,
      setFollowingOnly,
      devMode,
      loading,
      createGroup,
      renameGroup,
      deleteGroup,
      getGroup,
      reconcileFromGroupStateEvent,
      groupSummaries,
    }),
    [
      groups,
      visibleGroups,
      followingOnly,
      setFollowingOnly,
      devMode,
      loading,
      createGroup,
      renameGroup,
      deleteGroup,
      getGroup,
      reconcileFromGroupStateEvent,
      groupSummaries,
    ],
  );

  return <GroupsContext.Provider value={contextValue}>{children}</GroupsContext.Provider>;
};

export function useGroups(): GroupsContextType {
  const ctx = useContext(GroupsContext);
  if (!ctx) throw new Error('useGroups must be used within a GroupsProvider');
  return ctx;
}
