import React, { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from '../components/BrandedAlert';
import { useNostr } from '../contexts/NostrContext';
import {
  stripImageMetadata,
  uploadImage,
  uploadEncryptedBlob,
} from '../services/imageUploadService';
import {
  getCurrentLocation,
  formatGeoMessage,
  formatCoordsForDisplay,
} from '../services/locationService';
import { nprofileEncode, buildProfileRelayHints } from '../services/nostrService';
import { encodeEncryptedFileUrl } from '../utils/encryptedFileUrl';
import type { PickedFriend } from '../components/FriendPickerSheet';
import type { Gif } from '../services/giphyService';
import type { ConversationMessageInput } from '../utils/conversationItems';

/**
 * Send/upload/share actions for the 1:1 ConversationScreen (#235 onward),
 * plus their in-flight flags. Extracted from the screen so the screen file
 * stays focused on layout + wiring (and under the #703 size cap), and so this
 * orchestration — optimistic UI, EXIF stripping, picker dismissal, Blossom
 * upload, permission prompts — lives in one cohesive, reusable unit.
 *
 * The hook consumes `useNostr()` directly (owning its context dependency).
 * The caller passes only the screen-owned bits: the conversation peer, the
 * composer draft, the message-list setter, and the panel/picker setters.
 *
 * Layering note: this sits ABOVE the context's raw send methods
 * (`sendDirectMessage`) — the context publishes the event; this hook adds the
 * UX around it (optimistic bubble, error alerts, attachment flows).
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

  const {
    isLoggedIn,
    sendDirectMessage,
    sendFileMessage,
    appendLocalDmMessage,
    signEvent,
    contacts,
    relays,
  } = useNostr();

  const [sending, setSending] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [sharingLocation, setSharingLocation] = useState(false);
  const [uploadingVoice, setUploadingVoice] = useState(false);

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

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const result = await sendDirectMessage(pubkey, text);
      if (!result.success) {
        Alert.alert('Send failed', result.error ?? 'Could not send message.');
        return;
      }
      setDraft('');
      appendOptimisticLocal(text);
    } finally {
      setSending(false);
    }
  }, [draft, sending, sendDirectMessage, pubkey, appendOptimisticLocal, setDraft]);

  const handleShareLocation = useCallback(async () => {
    if (sharingLocation) return;
    setAttachPanelOpen(false);
    setSharingLocation(true);
    try {
      const result = await getCurrentLocation();
      if (!result.ok) {
        Alert.alert('Could not share location', result.message);
        return;
      }
      const loc = result.location;
      await new Promise<void>((resolve) => {
        // `pressed` guards against `onDismiss` firing while a button's
        // onPress is still awaiting `sendDirectMessage`. Without it, the
        // outer Promise can resolve early, clear `sharingLocation`, and
        // re-enable the Attach button mid-publish — a classic double-submit
        // window we don't want.
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
                resolve();
              },
            },
            {
              text: 'Share',
              style: 'default',
              onPress: async () => {
                pressed = true;
                const text = formatGeoMessage(loc);
                const sendResult = await sendDirectMessage(pubkey, text);
                if (!sendResult.success) {
                  Alert.alert('Send failed', sendResult.error ?? 'Could not send location.');
                } else {
                  appendOptimisticLocal(text);
                }
                resolve();
              },
            },
          ],
          {
            cancelable: true,
            onDismiss: () => {
              if (!pressed) resolve();
            },
          },
        );
      });
    } finally {
      setSharingLocation(false);
    }
  }, [sharingLocation, name, pubkey, sendDirectMessage, appendOptimisticLocal, setAttachPanelOpen]);

  // Shared send-image path for both gallery and camera entry points.
  // Strips EXIF from the picked image, uploads to the user's configured
  // Blossom server (or nostr.build fallback), then DMs the returned URL
  // to the conversation partner.
  const uploadAndSendImage = useCallback(
    async (localUri: string, pickerBase64?: string | null) => {
      setUploadingImage(true);
      try {
        const scrubbed = await stripImageMetadata(localUri, pickerBase64);
        const url = await uploadImage(scrubbed.uri, signEvent, scrubbed.base64);
        const sendResult = await sendDirectMessage(pubkey, url);
        if (!sendResult.success) {
          Alert.alert('Send failed', sendResult.error ?? 'Could not send image.');
          return;
        }
        appendOptimisticLocal(url);
      } catch (error) {
        Alert.alert('Upload failed', error instanceof Error ? error.message : 'Please try again.');
      } finally {
        setUploadingImage(false);
      }
    },
    [signEvent, sendDirectMessage, pubkey, appendOptimisticLocal],
  );

  const handlePickAndSendImage = useCallback(async () => {
    if (!isLoggedIn || uploadingImage || sending) return;
    setAttachPanelOpen(false);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to send images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      // Needed so stripImageMetadata can pass animated GIFs through
      // without re-encoding (expo-image-manipulator has no animated
      // output format). No-op for JPEG/PNG — those get re-encoded.
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    await uploadAndSendImage(result.assets[0].uri, result.assets[0].base64);
  }, [isLoggedIn, uploadingImage, sending, uploadAndSendImage, setAttachPanelOpen]);

  const handleTakeAndSendPhoto = useCallback(async () => {
    if (!isLoggedIn || uploadingImage || sending) return;
    setAttachPanelOpen(false);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow camera access to take and send photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
      // Camera never captures GIF, but keep the shape consistent with the
      // gallery path — harmless for JPEG output.
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    await uploadAndSendImage(result.assets[0].uri, result.assets[0].base64);
  }, [isLoggedIn, uploadingImage, sending, uploadAndSendImage, setAttachPanelOpen]);

  // Share another contact's Nostr profile into this conversation. Payload
  // mirrors the ContactProfileSheet → "Share with friend" format: a
  // human-readable first line plus a NIP-21 `nostr:nprofile…` URI that
  // other Nostr clients (Damus, Amethyst, Primal, …) render as a
  // clickable profile mention.
  const handleShareContactPicked = useCallback(
    async (friend: PickedFriend) => {
      // Dismiss both sheets in reverse stack order (top first).
      setContactPickerOpen(false);
      setAttachPanelOpen(false);
      const readRelays = relays.filter((r) => r.read).map((r) => r.url);
      const relayHints = buildProfileRelayHints(friend.pubkey, contacts, readRelays);
      const nprofile = nprofileEncode(friend.pubkey, relayHints);
      const label = friend.name || 'a contact';
      const payload = `Shared contact: ${label}\nnostr:${nprofile}`;
      const result = await sendDirectMessage(pubkey, payload);
      if (!result.success) {
        Alert.alert('Share failed', result.error ?? 'Could not share contact.');
        return;
      }
      appendOptimisticLocal(payload);
    },
    [
      pubkey,
      sendDirectMessage,
      contacts,
      relays,
      appendOptimisticLocal,
      setContactPickerOpen,
      setAttachPanelOpen,
    ],
  );

  const handleSendGif = useCallback(
    async (gif: Gif) => {
      setGifPickerOpen(false);
      setAttachPanelOpen(false);
      const payload = gif.url;
      const result = await sendDirectMessage(pubkey, payload);
      if (!result.success) {
        Alert.alert('Send failed', result.error ?? 'Could not send GIF.');
        return;
      }
      appendOptimisticLocal(payload);
    },
    [pubkey, sendDirectMessage, appendOptimisticLocal, setGifPickerOpen, setAttachPanelOpen],
  );

  // Voice-note send (#235): encrypt the recorded .m4a on-device (AES-256-GCM),
  // upload the CIPHERTEXT to Blossom, then send a NIP-17 kind-15 file message —
  // so the server never sees the audio and the recipient decrypts with the key
  // carried inside the E2E-encrypted DM. The optimistic bubble stores the same
  // encoded URL so it plays locally right away.
  const handleSendVoiceNote = useCallback(
    async (uri: string) => {
      if (uploadingVoice) return;
      setUploadingVoice(true);
      try {
        const file = await uploadEncryptedBlob(uri, signEvent, 'audio/mp4');
        const sendResult = await sendFileMessage(pubkey, file);
        if (!sendResult.success) {
          Alert.alert('Send failed', sendResult.error ?? 'Could not send voice note.');
          return;
        }
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
        setVoiceSheetOpen(false);
        setAttachPanelOpen(false);
      } catch (error) {
        Alert.alert('Upload failed', error instanceof Error ? error.message : 'Please try again.');
      } finally {
        setUploadingVoice(false);
      }
    },
    [
      pubkey,
      sendFileMessage,
      signEvent,
      uploadingVoice,
      setMessages,
      setVoiceSheetOpen,
      setAttachPanelOpen,
    ],
  );

  return {
    sending,
    uploadingImage,
    sharingLocation,
    uploadingVoice,
    appendOptimisticLocal,
    handleSend,
    handleShareLocation,
    handlePickAndSendImage,
    handleTakeAndSendPhoto,
    handleShareContactPicked,
    handleSendGif,
    handleSendVoiceNote,
  };
}
