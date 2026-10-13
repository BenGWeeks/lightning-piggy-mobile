import { useCallback, useEffect, useMemo } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import type { SearchableMessage } from '../utils/chatSearch';
import { useChatSearch } from './useChatSearch';

export function useChatTools(
  messages: SearchableMessage[],
  info: RootStackParamList['ChatInfo'],
  target: RootStackParamList['ChatMedia']['target'],
  jump: (id: string) => unknown,
  clear: () => Promise<void>,
  leaveEdge: (holdMs: number) => void,
  renderedIds: readonly string[],
) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const jumpToHistory = useCallback(
    (id: string) => {
      leaveEdge(1500);
      return jump(id);
    },
    [leaveEdge, jump],
  );
  const renderedMessages = useMemo(() => {
    const ids = new Set(renderedIds);
    return messages.filter((m) => ids.has(m.id));
  }, [messages, renderedIds]);
  const search = useChatSearch(renderedMessages, jumpToHistory);
  const pending = (route.params as { jumpToMessage?: string })?.jumpToMessage;
  useEffect(() => {
    if (pending && renderedMessages.some((m) => m.id === pending)) {
      if (jumpToHistory(pending)) navigation.setParams({ jumpToMessage: undefined });
    }
  }, [pending, renderedMessages, jumpToHistory, navigation]);
  const onInfo = useCallback(() => navigation.navigate('ChatInfo', info), [navigation, info]);
  const onAttachments = useCallback(
    () => navigation.navigate('ChatMedia', { messages: renderedMessages, target }),
    [navigation, renderedMessages, target],
  );
  const menu = useMemo(
    () => ({
      sender: info.groupId ? `group:${info.groupId}` : (info.contact?.pubkey ?? ''),
      group: !!info.groupId,
      onInfo,
      onAttachments,
      onSearch: search.open,
      onClear: clear,
    }),
    [info, onInfo, onAttachments, search.open, clear],
  );
  return { search, menu };
}
