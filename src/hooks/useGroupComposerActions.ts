import React, { useCallback } from 'react';
import { Alert } from '../components/BrandedAlert';
import { useNostr, notifyGroupMessage } from '../contexts/NostrContext';
import { appendGroupMessage, type GroupMessage } from '../services/groupMessagesStorageService';
import { encodeEncryptedFileUrl } from '../utils/encryptedFileUrl';
import type { EncryptedUpload } from '../services/imageUploadService';
import type { Group } from '../types/groups';
import { useComposerActions } from './useComposerActions';

/**
 * Group GroupConversationScreen composer actions. A thin wrapper over the
 * shared `useComposerActions` (#235): it provides the group send strategy
 * (`sendGroupMessage` text / kind-15 file + an optimistic `local_…`-row append
 * with scroll) and re-exposes the shared handlers, plus the group-only
 * `handleSendInvoiceToGroup`. The 1:1 sibling is `useConversationComposerActions`.
 */
export function useGroupComposerActions(params: {
  group: Group | undefined;
  draft: string;
  setDraft: (value: string) => void;
  setMessages: React.Dispatch<React.SetStateAction<GroupMessage[]>>;
  scrollToEnd: () => void;
  setAttachPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setGifPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setContactPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setVoiceSheetOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const {
    group,
    draft,
    setDraft,
    setMessages,
    scrollToEnd,
    setAttachPanelOpen,
    setGifPickerOpen,
    setContactPickerOpen,
    setVoiceSheetOpen,
  } = params;

  const { sendGroupMessage, pubkey: myPubkey } = useNostr();

  // Optimistically append a `local_…` row (dup window vs the inbound self-wrap
  // is a known follow-up, PR #227) and scroll to it.
  const appendOptimisticGroupRow = useCallback(
    async (text: string) => {
      if (!group || !myPubkey) return;
      const local: GroupMessage = {
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        senderPubkey: myPubkey,
        text,
        createdAt: Math.floor(Date.now() / 1000),
      };
      try {
        const next = await appendGroupMessage(group.id, local);
        setMessages(next);
        notifyGroupMessage(group.id, local);
        setTimeout(scrollToEnd, 0);
      } catch (err) {
        if (__DEV__) console.warn('[GroupConversationScreen] appendGroupMessage failed:', err);
      }
    },
    [group, myPubkey, setMessages, scrollToEnd],
  );

  const sendText = useCallback(
    async (text: string): Promise<boolean> => {
      if (!group || !myPubkey) return false;
      const result = await sendGroupMessage({
        groupId: group.id,
        subject: group.name,
        memberPubkeys: group.memberPubkeys,
        text,
      });
      if (!result.success) {
        Alert.alert('Send failed', result.error ?? 'Unknown error');
        return false;
      }
      await appendOptimisticGroupRow(text);
      return true;
    },
    [group, myPubkey, sendGroupMessage, appendOptimisticGroupRow],
  );

  const sendVoice = useCallback(
    async (file: EncryptedUpload): Promise<boolean> => {
      if (!group || !myPubkey) return false;
      const result = await sendGroupMessage({
        groupId: group.id,
        subject: group.name,
        memberPubkeys: group.memberPubkeys,
        file,
      });
      if (!result.success) {
        Alert.alert('Send failed', result.error ?? 'Could not send voice note.');
        return false;
      }
      await appendOptimisticGroupRow(
        encodeEncryptedFileUrl({
          url: file.url,
          mime: file.mime,
          keyHex: file.keyHex,
          nonceHex: file.nonceHex,
        }),
      );
      return true;
    },
    [group, myPubkey, sendGroupMessage, appendOptimisticGroupRow],
  );

  const actions = useComposerActions({
    strategy: { sendText, sendVoice },
    draft,
    setDraft,
    setAttachPanelOpen,
    setGifPickerOpen,
    setContactPickerOpen,
    setVoiceSheetOpen,
  });

  // Group-only: ReceiveSheet hands us a bolt11 via `onSendToGroup`. Post it
  // directly (NOT via the strategy's sendText, which raises its own Alert on
  // failure — ReceiveSheet shows a Toast too, and stacking both reads as a bug).
  const handleSendInvoiceToGroup = useCallback(
    async (payload: string): Promise<{ success: boolean; error?: string }> => {
      if (!group || !myPubkey) return { success: false, error: 'Group unavailable.' };
      const result = await sendGroupMessage({
        groupId: group.id,
        subject: group.name,
        memberPubkeys: group.memberPubkeys,
        text: payload,
      });
      if (!result.success) return { success: false, error: result.error ?? 'Send failed' };
      await appendOptimisticGroupRow(payload);
      return { success: true };
    },
    [group, myPubkey, sendGroupMessage, appendOptimisticGroupRow],
  );

  return { ...actions, handleSendInvoiceToGroup };
}
