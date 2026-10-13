import type { GroupTimelineRow } from './useGroupTimeline';
import { useMemo } from 'react';
import { getMarmotSession } from '../services/marmotSession';
import type { RootStackParamList } from '../navigation/types';
import type { GroupMemberRow } from '../utils/groupMemberRows';
import type { Group } from '../types/groups';
import type { SearchableMessage } from '../utils/chatSearch';
import type { useGroupDevices } from './useGroupDevices';
import { groupDmProtocol } from '../utils/groupProtocol';
import { useChatTools } from './useChatTools';
export function useGroupChatTools(
  messages: SearchableMessage[],
  group: Group | undefined,
  members: GroupMemberRow[],
  devices: ReturnType<typeof useGroupDevices>,
  jump: (id: string) => unknown,
  clear: () => Promise<void>,
  leaveEdge: (holdMs: number) => void,
  rows: readonly GroupTimelineRow[],
) {
  const renderedIds = useMemo(
    () => rows.filter((row) => !('deviceNotice' in row)).map((row) => row.id),
    [rows],
  );
  const info = useMemo<RootStackParamList['ChatInfo']>(
    () => ({
      name: group?.name ?? '',
      groupId: group?.id,
      protocol: groupDmProtocol(group ?? {}),

      members,
      chatId: devices.chatId,
      deviceCounts: [...(devices.counts ?? [])],
      relays: group ? (getMarmotSession()?.getGroup(group.id)?.relays ?? []) : [],
    }),
    [group, members, devices.chatId, devices.counts],
  );
  const target = useMemo(
    () => ({ screen: 'GroupConversation' as const, params: { groupId: group?.id ?? '' } }),
    [group?.id],
  );
  return useChatTools(messages, info, target, jump, clear, leaveEdge, renderedIds);
}
