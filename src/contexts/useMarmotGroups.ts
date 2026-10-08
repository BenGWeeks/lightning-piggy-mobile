import { useCallback, useEffect, useMemo, useState } from 'react';

import { appendGroupMessage, type GroupMessage } from '../services/groupMessagesStorageService';
import { marmotRumorToGroupMessage } from '../services/marmotInbox';
import { requireMarmotSession } from '../services/marmotSend';
import {
  subscribeMarmotSession,
  type MarmotGroupSummary,
  type MarmotMessageEvent,
} from '../services/marmotSession';
import { fireMessageNotification } from '../services/notificationService';
import type { Group } from '../types/groups';
import { notifyGroupMessage } from './nostrEventBus';

const FLUSH_MS = 150;
const NOTIFY_SKEW_SEC = 120;

const toGroup = (g: MarmotGroupSummary): Group => ({
  id: g.id,
  name: g.name,
  memberPubkeys: g.memberPubkeys,
  createdAt: g.createdAt,
  updatedAt: g.createdAt,
  protocol: 'marmot',
  adminPubkeys: g.adminPubkeys,
});

export interface MarmotGroupsApi {
  /** Multi-member Marmot groups (1:1 DM groups live in the DM inbox). */
  groups: Group[];
  create: (name: string, memberPubkeys: string[]) => Promise<Group>;
  rename: (groupId: string, name: string) => Promise<boolean>;
  addMembers: (groupId: string, pubkeys: string[]) => Promise<Group | null>;
  removeMember: (groupId: string, pubkey: string) => Promise<Group | null>;
  leave: (groupId: string) => Promise<void>;
}

/**
 * GroupsContext's Marmot half: mirrors the session's multi-member groups as
 * app `Group`s, runs membership ops through MLS commits, and stores inbound
 * group messages (coalesced: one append pass + one notify per group per
 * ≤150 ms burst — #perf).
 */
export function useMarmotGroups(pubkey: string | null): MarmotGroupsApi {
  const [summaries, setSummaries] = useState<MarmotGroupSummary[]>([]);

  useEffect(() => {
    if (!pubkey) {
      setSummaries([]);
      return;
    }
    const openedAtSec = Math.floor(Date.now() / 1000);
    let pending: MarmotMessageEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribeMessages: (() => void) | null = null;

    const flush = async () => {
      timer = null;
      const batch = pending;
      pending = [];
      const byGroup = new Map<string, GroupMessage[]>();
      for (const { group, rumor } of batch) {
        const list = byGroup.get(group.id) ?? [];
        list.push(marmotRumorToGroupMessage(rumor));
        byGroup.set(group.id, list);
      }
      for (const [groupId, messages] of byGroup) {
        for (const m of messages) await appendGroupMessage(groupId, m);
        notifyGroupMessage(groupId, messages[messages.length - 1]);
      }
    };

    const onMessage = (event: MarmotMessageEvent) => {
      if (event.group.isDm) return; // useMarmotDmInbound owns these
      pending.push(event);
      if (!timer) timer = setTimeout(() => void flush(), FLUSH_MS);
      const { rumor, group } = event;
      const fromMe = rumor.pubkey.toLowerCase() === pubkey.toLowerCase();
      if (!fromMe && rumor.created_at >= openedAtSec - NOTIFY_SKEW_SEC) {
        const text = marmotRumorToGroupMessage(rumor).text;
        void fireMessageNotification({
          kind: 'group',
          threadId: group.id,
          title: group.name || 'New group message',
          body: text,
          data: { groupId: group.id },
          owner: pubkey,
        });
      }
    };

    const unsubscribeSession = subscribeMarmotSession((session) => {
      unsubscribeMessages?.();
      if (!session || session.pubkey !== pubkey) {
        unsubscribeMessages = null;
        setSummaries([]);
        return;
      }
      setSummaries(session.listGroups());
      unsubscribeMessages = session.subscribe({ onMessage, onGroupsChanged: setSummaries });
    });
    return () => {
      unsubscribeSession();
      unsubscribeMessages?.();
      if (timer) clearTimeout(timer);
      void flush();
    };
  }, [pubkey]);

  const groups = useMemo(() => summaries.filter((g) => !g.isDm).map(toGroup), [summaries]);

  const session = useCallback(() => {
    if (!pubkey) throw new Error('Not logged in');
    return requireMarmotSession(pubkey);
  }, [pubkey]);
  const current = useCallback(
    (groupId: string) => {
      const g = session().getGroup(groupId);
      return g ? toGroup(g) : null;
    },
    [session],
  );

  const create = useCallback(
    async (name: string, memberPubkeys: string[]) =>
      toGroup(await session().createGroup(name.trim(), [...new Set(memberPubkeys)])),
    [session],
  );
  const rename = useCallback(
    async (groupId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return false;
      await session().rename(groupId, trimmed);
      return true;
    },
    [session],
  );
  const addMembers = useCallback(
    async (groupId: string, pubkeys: string[]) => {
      const existing = new Set(current(groupId)?.memberPubkeys ?? []);
      const toAdd = [...new Set(pubkeys)].filter((pk) => !existing.has(pk));
      if (toAdd.length > 0) await session().addMembers(groupId, toAdd);
      return current(groupId);
    },
    [session, current],
  );
  const removeMember = useCallback(
    async (groupId: string, pubkey: string) => {
      await session().removeMember(groupId, pubkey);
      return current(groupId);
    },
    [session, current],
  );
  const leave = useCallback((groupId: string) => session().leave(groupId), [session]);

  return useMemo(
    () => ({ groups, create, rename, addMembers, removeMember, leave }),
    [groups, create, rename, addMembers, removeMember, leave],
  );
}
