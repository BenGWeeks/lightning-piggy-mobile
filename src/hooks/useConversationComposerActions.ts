import React, { useCallback } from 'react';
import { Alert } from '../components/BrandedAlert';
import { useNostr } from '../contexts/NostrContext';
import { formatCoordsForDisplay, type SharedLocation } from '../services/locationService';
import { encodeEncryptedFileUrl } from '../utils/encryptedFileUrl';
import type { EncryptedUpload } from '../services/imageUploadService';
import type { ConversationMessageInput } from '../utils/conversationItems';
import { useComposerActions } from './useComposerActions';

/**
 * 1:1 ConversationScreen composer actions. A thin wrapper over the shared
 * `useComposerActions` (#235): it provides the 1:1 send strategy
 * (`sendDirectMessage` / `sendFileMessage` + an optimistic DM-row append, and a
 * "share location with X?" confirm dialog) and re-exposes the shared handlers.
 * The group sibling is `useGroupComposerActions`.
 */
export function useConversationComposerActions(params: {
  pubkey: string;
  name: string;
  draft: string;
  setDraft: (value: string) => void;
  setMessages: React.Dispatch<React.SetStateAction<ConversationMessageInput[]>>;
  setAttachPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setContactPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setGifPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setVoiceSheetOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const {
    pubkey,
    name,
    draft,
    setDraft,
    setMessages,
    setAttachPanelOpen,
    setContactPickerOpen,
    setGifPickerOpen,
    setVoiceSheetOpen,
  } = params;

  const { sendDirectMessage, sendFileMessage, appendLocalDmMessage } = useNostr();

  // Optimistically append a locally-sent row; the relay echo dedups in
  // mergeConversationMessages. Also persisted via appendLocalDmMessage.
  const appendOptimisticLocal = useCallback(
    (text: string) => {
      const optimistic = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fromMe: true,
        text,
        createdAt: Math.floor(Date.now() / 1000),
      };
      setMessages((prev) => [...prev, optimistic]);
      void appendLocalDmMessage(pubkey, optimistic);
    },
    [appendLocalDmMessage, pubkey, setMessages],
  );

  const sendText = useCallback(
    async (text: string): Promise<boolean> => {
      const result = await sendDirectMessage(pubkey, text);
      if (!result.success) {
        Alert.alert('Send failed', result.error ?? 'Could not send message.');
        return false;
      }
      appendOptimisticLocal(text);
      return true;
    },
    [pubkey, sendDirectMessage, appendOptimisticLocal],
  );

  const sendVoice = useCallback(
    async (file: EncryptedUpload): Promise<boolean> => {
      const result = await sendFileMessage(pubkey, file);
      if (!result.success) {
        Alert.alert('Send failed', result.error ?? 'Could not send voice note.');
        return false;
      }
      // Optimistic bubble stores the same encoded URL so it plays right away.
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          fromMe: true,
          text: encodeEncryptedFileUrl({
            url: file.url,
            mime: file.mime,
            keyHex: file.keyHex,
            nonceHex: file.nonceHex,
          }),
          createdAt: Math.floor(Date.now() / 1000),
        },
      ]);
      return true;
    },
    [pubkey, sendFileMessage, setMessages],
  );

  // 1:1 confirms before sharing location. `pressed` guards against `onDismiss`
  // resolving after a button already did.
  const confirmLocation = useCallback(
    (loc: SharedLocation) =>
      new Promise<boolean>((resolve) => {
        let pressed = false;
        Alert.alert(
          `Share location with ${name}?`,
          `${formatCoordsForDisplay(loc)}\n\nYour message will be end-to-end encrypted. ${name} will see a map preview from OpenStreetMap.`,
          [
            {
              text: 'Cancel',
              style: 'cancel',
              onPress: () => {
                pressed = true;
                resolve(false);
              },
            },
            {
              text: 'Share',
              style: 'default',
              onPress: () => {
                pressed = true;
                resolve(true);
              },
            },
          ],
          {
            cancelable: true,
            onDismiss: () => {
              if (!pressed) resolve(false);
            },
          },
        );
      }),
    [name],
  );

  const actions = useComposerActions({
    strategy: { sendText, sendVoice, confirmLocation },
    draft,
    setDraft,
    setAttachPanelOpen,
    setGifPickerOpen,
    setContactPickerOpen,
    setVoiceSheetOpen,
  });

  return { ...actions, appendOptimisticLocal };
}
