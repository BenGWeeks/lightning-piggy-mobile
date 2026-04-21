import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Group } from '../types/groups';
import { createGroupId, loadGroups, saveGroups } from '../services/groupsStorageService';

interface GroupsContextType {
  groups: Group[];
  loading: boolean;
  createGroup: (name: string, memberPubkeys: string[]) => Promise<Group>;
  renameGroup: (groupId: string, newName: string) => Promise<boolean>;
  deleteGroup: (groupId: string) => Promise<void>;
  getGroup: (groupId: string) => Group | undefined;
}

const GroupsContext = createContext<GroupsContextType | undefined>(undefined);

export const GroupsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

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
      return group;
    },
    [groups, persist],
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
      return true;
    },
    [groups, persist],
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

  return (
    <GroupsContext.Provider
      value={{ groups, loading, createGroup, renameGroup, deleteGroup, getGroup }}
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
