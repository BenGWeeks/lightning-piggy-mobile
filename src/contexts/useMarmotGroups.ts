import { useAccountState } from './useAccountState';
import { useCallback, useEffect, useMemo } from 'react';

import {
  appendGroupMessage,
  removeGroupMessagesWhere,
  type GroupMessage,
} from '../services/groupMessagesStorageService';
import { DeletionLedger, parseMarmotDeletion } from '../services/marmotDeletions';
import {
  isMarmotMessageKind,
  marmotRumorToGroupMessage,
  storedMarmotContent,
} from '../services/marmotInbox';
import { dmRowPreview } from '../utils/dmRowPreview';
import { requireMarmotSession } from '../services/marmotSend';
import {
  subscribeMarmotSession,
  type MarmotGroupSummary,
  type MarmotMessageEvent,
} from '../services/marmotSession';
import { dismissNotificationsFor, fireMessageNotification } from '../services/notificationService';
import type { Group } from '../types/groups';
import { notifyGroupMessage } from './nostrEventBus';

const EMPTY_SUMMARIES: MarmotGroupSummary[] = [];

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
  const [summaries, setSummaries] = useAccountState(pubkey, EMPTY_SUMMARIES);

  useEffect(() => {
    if (!pubkey) {
      setSummaries([]);
      return;
    }
    const openedAtSec = Math.floor(Date.now() / 1000);
    let pending: MarmotMessageEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribeMessages: (() => void) | null = null;

    // Flushes run strictly one after another: appendGroupMessage is an
    // AsyncStorage read-modify-write, so overlapping flushes for one group
    // could clobber each other's rows.
    let chain: Promise<void> = Promise.resolve();
    const flush = () => {
      timer = null;
      const batch = pending;
      pending = [];
      if (batch.length === 0) return chain;
      chain = chain
        .then(() => writeBatch(batch))
        .catch((e) => {
          if (__DEV__) console.warn('[Marmot] group message write failed:', e);
        });
      return chain;
    };
    // "Delete for everyone": what has been deleted per group (arrival order
    // and history replays can put a delete before its target).
    const ledger = new DeletionLedger();
    const writeBatch = async (batch: MarmotMessageEvent[]) => {
      const byGroup = new Map<string, GroupMessage[]>();
      const deletedIn = new Set<string>();
      for (const { group, rumor, mediaKeys } of batch) {
        const list = byGroup.get(group.id) ?? [];
        byGroup.set(group.id, list);
        if (parseMarmotDeletion(rumor, group)) {
          deletedIn.add(group.id);
          continue;
        }
        const message = marmotRumorToGroupMessage(rumor, mediaKeys);
        // Deleted before it was stored (arrived after its delete, or replayed).
        if (!ledger.blocks(message.id, message.senderPubkey, group.id)) list.push(message);
      }
      for (const [groupId, messages] of byGroup) {
        for (const m of messages) await appendGroupMessage(groupId, m);
        // Erase what's already stored (earlier batches / sessions).
        if (deletedIn.has(groupId)) {
          await removeGroupMessagesWhere(groupId, (m) =>
            ledger.blocks(m.id, m.senderPubkey, groupId),
          );
        }
        if (messages.length > 0 || deletedIn.has(groupId)) {
          notifyGroupMessage(groupId, messages[messages.length - 1]);
        }
      }
    };

    const onMessage = (event: MarmotMessageEvent) => {
      if (event.group.isDm) return; // useMarmotDmInbound owns these
      const deletion = parseMarmotDeletion(event.rumor, event.group);
      if (deletion) {
        ledger.add(deletion, event.group.id);
        pending.push(event);
        if (!timer) timer = setTimeout(() => void flush(), FLUSH_MS);
        // A notification already showing the deleted text goes too (only a
        // live deletion can have one — a replayed old one has long gone).
        if (event.rumor.created_at >= openedAtSec - NOTIFY_SKEW_SEC) {
          for (const messageId of deletion.targets) void dismissNotificationsFor({ messageId });
        }
        return;
      }
      if (!isMarmotMessageKind(event.rumor.kind)) return; // plumbing, not a message
      pending.push(event);
      if (!timer) timer = setTimeout(() => void flush(), FLUSH_MS);
      const { rumor, group } = event;
      const fromMe = rumor.pubkey.toLowerCase() === pubkey.toLowerCase();
      if (ledger.blocks(rumor.id, rumor.pubkey, group.id)) return; // already deleted
      if (!fromMe && rumor.created_at >= openedAtSec - NOTIFY_SKEW_SEC) {
        // Redacted like the DM inbox: a photo's stored text embeds its keys.
        const stored = storedMarmotContent(rumor, event.mediaKeys);
        const text = dmRowPreview(stored.text, stored.kind);
        void fireMessageNotification({
          kind: 'group',
          threadId: group.id,
          title: group.name || 'New group message',
          body: text,
          data: { groupId: group.id, messageId: rumor.id },
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
  }, [pubkey, setSummaries]);

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
