import { useAccountState } from './useAccountState';
import { useCallback, useEffect, useMemo } from 'react';

import {
  appendGroupMessage,
  loadGroupMessages,
  removeGroupMessagesWhere,
  type GroupMessage,
} from '../services/groupMessagesStorageService';
import { mayDelete, parseMarmotDeletion, type MarmotDeletion } from '../services/marmotDeletions';
import { MarmotDeletionTracker } from '../services/marmotDeletionTracker';
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
import { fireMessageNotification } from '../services/notificationService';
import { Toast } from '../components/BrandedToast';
import { t } from '../i18n';
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
export function useMarmotGroups(
  pubkey: string | null,
  /** Display name for a pubkey (for "invitation not delivered yet"). */
  nameOf: (pubkey: string) => string = (pk) => pk.slice(0, 8),
): MarmotGroupsApi {
  const [summaries, setSummaries] = useAccountState(pubkey, EMPTY_SUMMARIES);

  useEffect(() => {
    if (!pubkey) {
      setSummaries([]);
      return;
    }
    const openedAtSec = Math.floor(Date.now() / 1000);
    let disposed = false;
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
    const deletions = new MarmotDeletionTracker(pubkey, openedAtSec);
    const writeBatch = async (batch: MarmotMessageEvent[]) => {
      const byGroup = new Map<string, GroupMessage[]>();
      const deletedIn = new Map<string, MarmotDeletion[]>();
      const incoming: { event: MarmotMessageEvent; message: GroupMessage }[] = [];
      for (const event of batch) {
        const { group, rumor, mediaKeys } = event;
        if (!byGroup.has(group.id)) byGroup.set(group.id, []);
        const deletion = parseMarmotDeletion(rumor, group);
        if (deletion) {
          deletedIn.set(group.id, [...(deletedIn.get(group.id) ?? []), deletion]);
          continue;
        }
        incoming.push({ event, message: marmotRumorToGroupMessage(rumor, mediaKeys) });
      }
      // Deleted before it was stored (arrived after its delete, or replayed):
      // one tombstone query for the whole batch, after this batch's deletions
      // are durable. Fails closed (the history replays them next start), and
      // the removals below still run.
      let live: typeof incoming = [];
      try {
        await deletions.persist();
        live = await deletions.filterLive(incoming, ({ event, message }) => ({
          scope: event.group.id,
          id: message.id,
          sender: message.senderPubkey,
        }));
      } catch (e) {
        if (__DEV__) console.warn('[Marmot] deletion check failed:', e);
      }
      for (const { event, message } of live) byGroup.get(event.group.id)!.push(message);
      for (const [groupId, messages] of byGroup) {
        for (const m of messages) await appendGroupMessage(groupId, m);
        // Erase what's already stored (earlier batches / sessions).
        const groupDeletions = deletedIn.get(groupId);
        if (groupDeletions) {
          await removeGroupMessagesWhere(groupId, (m) =>
            groupDeletions.some((d) => d.targets.includes(m.id) && mayDelete(d, m.senderPubkey)),
          );
        }
        if (messages.length > 0 || groupDeletions) {
          const remaining = await loadGroupMessages(groupId);
          if (!disposed) notifyGroupMessage(groupId, remaining[remaining.length - 1]);
        }
      }
      for (const { event } of live) notifyMessage(event);
    };

    const onMessage = (event: MarmotMessageEvent) => {
      if (event.group.isDm) return; // useMarmotDmInbound owns these
      const deletion = parseMarmotDeletion(event.rumor, event.group);
      if (deletion) {
        deletions.note(event.group.id, deletion, event.rumor.created_at);
        pending.push(event);
        if (!timer) timer = setTimeout(() => void flush(), FLUSH_MS);
        return;
      }
      if (!isMarmotMessageKind(event.rumor.kind)) return; // plumbing, not a message
      pending.push(event);
      if (!timer) timer = setTimeout(() => void flush(), FLUSH_MS);
    };

    const notifyMessage = (event: MarmotMessageEvent) => {
      if (disposed) return;
      const { rumor, group } = event;
      const fromMe = rumor.pubkey.toLowerCase() === pubkey.toLowerCase();
      if (deletions.blocks(group.id, rumor.id, rumor.pubkey)) return; // already deleted
      if (!fromMe && rumor.created_at >= openedAtSec - NOTIFY_SKEW_SEC) {
        // Redacted like the DM inbox: a photo's stored text embeds its keys.
        const stored = storedMarmotContent(rumor, event.mediaKeys);
        const text = dmRowPreview(stored.text, stored.kind);
        void fireMessageNotification({
          kind: 'group',
          threadId: group.id,
          title: group.name || 'New group message',
          body: text,
          data: {
            groupId: group.id,
            messageId: rumor.id,
            marmotGroupId: group.id,
            senderPubkey: rumor.pubkey,
          },
          shouldSuppress: async () =>
            disposed || (await deletions.isDeleted(group.id, rumor.id, rumor.pubkey)),
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
      disposed = true;
      unsubscribeSession();
      unsubscribeMessages?.();
      if (timer) clearTimeout(timer);
      void flush();
      deletions.dispose();
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

  // Their Welcome is retried automatically; just say so.
  const reportUndelivered = useCallback(
    (people: string[]) => {
      if (people.length === 0) return;
      Toast.show({
        type: 'info',
        text1: t('marmotInvite.notReachedTitle'),
        text2: t('marmotInvite.notReachedBody', { names: people.map(nameOf).join(', ') }),
      });
    },
    [nameOf],
  );
  const create = useCallback(
    async (name: string, memberPubkeys: string[]) => {
      const group = await session().createGroup(name.trim(), [...new Set(memberPubkeys)]);
      reportUndelivered(group.undelivered);
      return toGroup(group);
    },
    [session, reportUndelivered],
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
      if (toAdd.length > 0) reportUndelivered(await session().addMembers(groupId, toAdd));
      return current(groupId);
    },
    [session, current, reportUndelivered],
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
