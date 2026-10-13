import type { Item } from '../utils/conversationItems';
import { useCallback, useMemo } from 'react';
import { getMarmotSession, toAppGroupId } from '../services/marmotSession';
import type { ContactProfileBodyData } from '../components/ContactProfileBody';
import type { RootStackParamList } from '../navigation/types';
import type { DmProtocol } from '../utils/dmProtocol';
import type { SearchableMessage } from '../utils/chatSearch';
import type { useDmDevices } from './useDmDevices';
import { useChatTools } from './useChatTools';
export function useDmChatTools(
  messages: SearchableMessage[],
  contact: ContactProfileBodyData,
  params: RootStackParamList['Conversation'],
  protocol: DmProtocol,
  devices: ReturnType<typeof useDmDevices>,
  jump: (id: string) => unknown,
  clear: () => Promise<void>,
  leaveEdge: (holdMs: number) => void,
  rows: readonly Item[],
) {
  const renderedIds = useMemo(
    () => rows.filter((row) => row.id.startsWith('dm-')).map((row) => row.id.slice(3)),
    [rows],
  );
  const info = useMemo<RootStackParamList['ChatInfo']>(
    () => ({
      name: contact.name,
      picture: contact.picture,
      contact,
      protocol,
      chatId: devices.chatId,
      deviceCounts: [...(devices.counts ?? [])],
      relays: devices.chatId
        ? (getMarmotSession()?.getGroup(toAppGroupId(devices.chatId))?.relays ?? [])
        : [],
    }),
    [contact, protocol, devices.chatId, devices.counts],
  );
  const target = useMemo(
    () => ({ screen: 'Conversation' as const, params: { ...params, protocol } }),
    [params, protocol],
  );
  const jumpToMessage = useCallback((id: string) => jump(`dm-${id}`), [jump]);
  return useChatTools(messages, info, target, jumpToMessage, clear, leaveEdge, renderedIds);
}
