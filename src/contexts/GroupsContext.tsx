import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Group } from '../types/groups';
import { createGroupId, loadGroups, saveGroups } from '../services/groupsStorageService';
import { useNostr } from './NostrContext';
import {
  DEFAULT_RELAYS,
  GROUP_STATE_KIND,
  subscribeGroupStateForViewer,
} from '../services/nostrService';

interface GroupsContextType {
  groups: Group[];
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
  const { publishGroupState, pubkey, relays, isLoggedIn } = useNostr();
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
      const idx = groups.findIndex((g) => g.id === input.groupId);
      if (idx === -1) {
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
