import { useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { subscribeGroupMessages } from '../contexts/NostrContext';
import { loadGroupMessages, type GroupMessage } from '../services/groupMessagesStorageService';
/** One focused subscription and one coalesced read for relay bursts. */
export function useGroupConversationLoader(
  owner: string | null,
  groupId: string | undefined,
  setMessages: (messages: GroupMessage[]) => void,
  setLoading: (loading: boolean) => void,
) {
  useFocusEffect(
    useCallback(() => {
      if (!groupId) return;
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let revision = 0;
      const load = async () => {
        const current = ++revision;
        try {
          const messages = await loadGroupMessages(owner, groupId);
          if (!cancelled && current === revision) setMessages(messages);
        } finally {
          if (!cancelled && current === revision) setLoading(false);
        }
      };
      void load().catch(() => {});
      const unsubscribe = subscribeGroupMessages((id) => {
        if (id !== groupId || timer) return;
        timer = setTimeout(() => {
          timer = undefined;
          void load().catch(() => {});
        }, 150);
      });
      return () => {
        cancelled = true;
        clearTimeout(timer);
        unsubscribe();
      };
    }, [owner, groupId, setMessages, setLoading]),
  );
}
