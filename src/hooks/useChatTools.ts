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
) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const search = useChatSearch(messages, jump);
  const pending = (route.params as { jumpToMessage?: string })?.jumpToMessage;
  useEffect(() => {
    if (pending && messages.some((m) => m.id === pending)) {
      if (jump(pending)) navigation.setParams({ jumpToMessage: undefined });
    }
  }, [pending, messages, jump, navigation]);
  const onInfo = useCallback(() => navigation.navigate('ChatInfo', info), [navigation, info]);
  const onAttachments = useCallback(
    () => navigation.navigate('ChatMedia', { messages, target }),
    [navigation, messages, target],
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
