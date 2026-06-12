import React, { useCallback, useMemo } from 'react';
import { Alert } from '../components/BrandedAlert';
import { useNostr } from '../contexts/NostrContext';
import { formatCoordsForDisplay, type SharedLocation } from '../services/locationService';
import { encodeEncryptedFileUrl } from '../utils/encryptedFileUrl';
import type { EncryptedUpload } from '../services/imageUploadService';
import type { ConversationMessageInput } from '../utils/conversationItems';
import type { DeliveryStatus } from '../utils/dmDeliveryStatus';
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
  // mergeConversationMessages. Also persisted via appendLocalDmMessage so the
  // delivery tick (#856) survives a thread reload. The `deliveryStatus` rides
  // on the same row — only the local- send copy carries it, never the relay
  // echo, so the persisted tick is authoritative.
  const appendOptimisticLocal = useCallback(
    (text: string, deliveryStatus?: DeliveryStatus) => {
      const optimistic = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fromMe: true,
        text,
        createdAt: Math.floor(Date.now() / 1000),
        deliveryStatus,
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
      appendOptimisticLocal(text, result.delivery);
      return true;
    },
    [pubkey, sendDirectMessage, appendOptimisticLocal],
  );

  const sendFile = useCallback(
    async (file: EncryptedUpload, kind: 'voice' | 'image'): Promise<boolean> => {
      const result = await sendFileMessage(pubkey, file);
      if (!result.success) {
        const what = kind === 'image' ? 'image' : 'voice note';
        Alert.alert('Send failed', result.error ?? `Could not send ${what}.`);
        return false;
      }
      // Optimistic bubble stores the same encoded URL so it renders right away.
      const optimistic = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fromMe: true,
        text: encodeEncryptedFileUrl({
          url: file.url,
          mime: file.mime,
          keyHex: file.keyHex,
          nonceHex: file.nonceHex,
        }),
        createdAt: Math.floor(Date.now() / 1000),
        deliveryStatus: result.delivery,
      };
      setMessages((prev) => [...prev, optimistic]);
      void appendLocalDmMessage(pubkey, optimistic);
      return true;
    },
    [pubkey, sendFileMessage, setMessages, appendLocalDmMessage],
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

  // Memoise the strategy so the shared hook's callbacks (which depend on it)
  // keep stable identities across renders. (1:1 needs no canSend preflight —
  // the peer pubkey is always present from the route params.)
  const strategy = useMemo(
    () => ({ sendText, sendFile, confirmLocation }),
    [sendText, sendFile, confirmLocation],
  );

  const actions = useComposerActions({
    strategy,
    draft,
    setDraft,
    setAttachPanelOpen,
    setGifPickerOpen,
    setContactPickerOpen,
    setVoiceSheetOpen,
  });

  // `sendText` re-exposed as `resendText` for the delivery sheet's Re-publish
  // (#856). It runs the full send path (publish + optimistic row + tick), so a
  // re-publish is indistinguishable from a fresh send and gets its own bubble.
  return { ...actions, appendOptimisticLocal, resendText: sendText };
}
