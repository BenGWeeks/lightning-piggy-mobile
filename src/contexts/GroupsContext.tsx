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
import type { Group } from '../types/groups';
import { createGroupId, loadGroups, saveGroups } from '../services/groupsStorageService';
import { setKnownGroups } from '../services/groupRoutingRegistry';
import { useNostr } from './NostrContext';
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
}

const GroupsContext = createContext<GroupsContextType | undefined>(undefined);

export const GroupsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [followingOnly, setFollowingOnlyState] = useState(true);
  const [devMode, setDevMode] = useState(false);
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

  const followPubkeys = useMemo(() => {
    const set = new Set<string>();
    for (const c of contacts) set.add(c.pubkey.toLowerCase());
    return set;
  }, [contacts]);

  // Anti-spam: a group is visible only if at least one OTHER member is
  // in the viewer's follow list. Mirror's the 1:1 "Following only" rule
  // at MessagesScreen.tsx:128-143. Locked-on outside dev_mode; in
  // dev_mode the user can flip it via the chip on GroupsScreen.
  const visibleGroups = useMemo(() => {
    const enforce = followingOnly || !devMode;
    if (!enforce) return groups;
    return groups.filter((g) => g.memberPubkeys.some((pk) => followPubkeys.has(pk.toLowerCase())));
  }, [groups, followPubkeys, followingOnly, devMode]);

  const persist = useCallback(async (next: Group[]) => {
    setGroups(next);
    await saveGroups(next);
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
      await persist([group, ...groups]);
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
    [groups, persist, publishGroupState],
  );

  const renameGroup = useCallback(
    async (groupId: string, newName: string): Promise<boolean> => {
      const trimmed = newName.trim();
      if (!trimmed) return false;
      const idx = groups.findIndex((g) => g.id === groupId);
      if (idx === -1) return false;
      const updated: Group = { ...groups[idx], name: trimmed, updatedAt: Date.now() };
      const next = [...groups];
      next[idx] = updated;
      await persist(next);
      publishGroupState({
        groupId: updated.id,
        name: updated.name,
        memberPubkeys: updated.memberPubkeys,
      }).catch((e) => {
        if (__DEV__) console.warn('[Groups] publishGroupState (rename) failed:', e);
      });
      return true;
    },
    [groups, persist, publishGroupState],
  );

  const deleteGroup = useCallback(
    async (groupId: string): Promise<void> => {
      await persist(groups.filter((g) => g.id !== groupId));
    },
    [groups, persist],
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
      const idx = groups.findIndex((g) => g.id === input.groupId);
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
        await persist([group, ...groups]);
        return true;
      }
      // Conflict-resolution: only apply if the incoming event is newer
      // than what we have locally.
      const existing = groups[idx];
      if (evMs <= existing.updatedAt) return false;
      // Creator-trust gate for updates: only accept renames/membership
      // changes from publishers already in the local member set (the
      // creator is implicitly there too — they were merged in via the
      // first event). Prevents a non-member from hijacking a group's
      // name on the viewer's device.
      const trustedPublishers = new Set(existing.memberPubkeys.map((pk) => pk.toLowerCase()));
      if (!trustedPublishers.has(senderLc)) {
        if (__DEV__) {
          console.log(
            `[Groups] dropping update to ${input.groupId} from non-member ${senderLc.slice(0, 8)}...`,
          );
        }
        return false;
      }
      const updated: Group = {
        ...existing,
        name: input.name,
        memberPubkeys: [...new Set(input.memberPubkeys)],
        updatedAt: evMs,
      };
      const next = [...groups];
      next[idx] = updated;
      await persist(next);
      return true;
    },
    [groups, persist],
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
        const memberPubkeys = ev.tags
          .filter((t) => t[0] === 'p' && typeof t[1] === 'string')
          .map((t) => t[1].toLowerCase());
        // Include the sender (creator) plus all p-tagged members. The
        // creator is implicit per the spec — they sign the event.
        const allMembers = Array.from(new Set([ev.pubkey.toLowerCase(), ...memberPubkeys])).filter(
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

  return (
    <GroupsContext.Provider
      value={{
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
      }}
    >
      {children}
    </GroupsContext.Provider>
  );
};

export function useGroups(): GroupsContextType {
  const ctx = useContext(GroupsContext);
  if (!ctx) throw new Error('useGroups must be used within a GroupsProvider');
  return ctx;
}
