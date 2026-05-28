import React, { useCallback, useMemo } from 'react';
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
  // is a known follow-up, PR #227) and scroll to it. Returns false if the local
  // persist failed — the relay send already succeeded, but the caller surfaces
  // that so the draft isn't cleared and the user can retry/refresh.
  const appendOptimisticGroupRow = useCallback(
    async (text: string): Promise<boolean> => {
      if (!group || !myPubkey) return false;
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
        return true;
      } catch (err) {
        if (__DEV__) console.warn('[GroupConversationScreen] appendGroupMessage failed:', err);
        Alert.alert(
          'Saved on relay, not on device',
          'Your message was sent, but we could not save it locally. Try again to refresh, or restart the app.',
        );
        return false;
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
      // Relay send succeeded; return the local-persist result so a failed
      // local save keeps the draft (and shows the "saved on relay" alert).
      return appendOptimisticGroupRow(text);
    },
    [group, myPubkey, sendGroupMessage, appendOptimisticGroupRow],
  );

  const sendFile = useCallback(
    async (file: EncryptedUpload, kind: 'voice' | 'image'): Promise<boolean> => {
      if (!group || !myPubkey) return false;
      const result = await sendGroupMessage({
        groupId: group.id,
        subject: group.name,
        memberPubkeys: group.memberPubkeys,
        file,
      });
      if (!result.success) {
        const what = kind === 'image' ? 'image' : 'voice note';
        Alert.alert('Send failed', result.error ?? `Could not send ${what}.`);
        return false;
      }
      return appendOptimisticGroupRow(
        encodeEncryptedFileUrl({
          url: file.url,
          mime: file.mime,
          keyHex: file.keyHex,
          nonceHex: file.nonceHex,
        }),
      );
    },
    [group, myPubkey, sendGroupMessage, appendOptimisticGroupRow],
  );

  // Preflight so the shared hook can skip an expensive encrypt+upload (voice /
  // image) when there's no valid group target to send to.
  const canSend = useCallback(() => !!group && !!myPubkey, [group, myPubkey]);

  // Memoise the strategy so the shared hook's callbacks (which depend on it)
  // keep stable identities across renders.
  const strategy = useMemo(() => ({ sendText, sendFile, canSend }), [sendText, sendFile, canSend]);

  const actions = useComposerActions({
    strategy,
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

  // `sendText` is also exposed so poll-share / poll-vote can post arbitrary
  // serialised bodies through the same optimistic-append path as the composer.
  return { ...actions, sendText, handleSendInvoiceToGroup };
}
