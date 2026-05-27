import React, { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from '../components/BrandedAlert';
import { useNostr } from '../contexts/NostrContext';
import {
  stripImageMetadata,
  uploadImage,
  uploadEncryptedBlob,
  type EncryptedUpload,
} from '../services/imageUploadService';
import {
  getCurrentLocation,
  formatGeoMessage,
  type SharedLocation,
} from '../services/locationService';
import { nprofileEncode, buildProfileRelayHints } from '../services/nostrService';
import type { PickedFriend } from '../components/FriendPickerSheet';
import type { Gif } from '../services/giphyService';

/**
 * The send-side behaviour that differs between the 1:1 and group composers —
 * the ONLY thing that differs. Everything else (gallery / camera / GIF /
 * contact / voice / location orchestration + permission prompts + in-flight
 * flags) is identical and lives in `useComposerActions` below.
 *
 * `sendText` / `sendVoice` each own their optimistic local append (+ scroll):
 * the 1:1 wrapper appends a DM row via `appendLocalDmMessage`; the group
 * wrapper appends a `local_…` row via `appendGroupMessage`. Returning a boolean
 * lets the shared hook clear the draft / close the sheet only on success.
 */
export interface ComposerSendStrategy {
  /** Send a plaintext payload (message / image URL / GIF URL / geo / contact
   *  share). Owns the optimistic append. Returns true on success. */
  sendText: (text: string) => Promise<boolean>;
  /** Send an encrypted file (voice note, NIP-17 kind-15). Owns the optimistic
   *  append. Returns true on success. */
  sendVoice: (file: EncryptedUpload) => Promise<boolean>;
  /** Optional gate before a location send. The 1:1 composer shows a confirm
   *  dialog (and resolves true/false); the group composer omits it and sends
   *  immediately. */
  confirmLocation?: (loc: SharedLocation) => Promise<boolean>;
}

export interface UseComposerActionsParams {
  strategy: ComposerSendStrategy;
  draft: string;
  setDraft: (value: string) => void;
  setAttachPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setGifPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setContactPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setVoiceSheetOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Shared composer send/upload/share orchestration for BOTH the 1:1
 * (ConversationScreen) and group (GroupConversationScreen) chats. The two used
 * to ship near-identical `useConversationComposerActions` /
 * `useGroupComposerActions` hooks (~90% duplicate, #235); this collapses the
 * shared 90% here and leaves each screen a thin wrapper that only provides its
 * `ComposerSendStrategy`. Owns the in-flight flags the composer reads.
 */
export function useComposerActions({
  strategy,
  draft,
  setDraft,
  setAttachPanelOpen,
  setGifPickerOpen,
  setContactPickerOpen,
  setVoiceSheetOpen,
}: UseComposerActionsParams) {
  const { isLoggedIn, signEvent, contacts, relays } = useNostr();

  const [sending, setSending] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [sharingLocation, setSharingLocation] = useState(false);
  const [uploadingVoice, setUploadingVoice] = useState(false);

  const closeAttachPanel = useCallback(() => setAttachPanelOpen(false), [setAttachPanelOpen]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const ok = await strategy.sendText(text);
      if (ok) setDraft('');
    } finally {
      setSending(false);
    }
  }, [draft, sending, strategy, setDraft]);

  // Shared gallery/camera path: strip EXIF, upload to Blossom (or nostr.build
  // fallback), then send the returned URL via the strategy.
  const uploadAndSendImage = useCallback(
    async (localUri: string, pickerBase64?: string | null) => {
      setUploadingImage(true);
      try {
        const scrubbed = await stripImageMetadata(localUri, pickerBase64);
        const url = await uploadImage(scrubbed.uri, signEvent, scrubbed.base64);
        await strategy.sendText(url);
      } catch (error) {
        Alert.alert('Upload failed', error instanceof Error ? error.message : 'Please try again.');
      } finally {
        setUploadingImage(false);
      }
    },
    [signEvent, strategy],
  );

  const handlePickAndSendImage = useCallback(async () => {
    if (!isLoggedIn || uploadingImage || sending) return;
    closeAttachPanel();
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to send images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      // Needed so stripImageMetadata can pass animated GIFs through without
      // re-encoding (expo-image-manipulator has no animated output). No-op for
      // JPEG/PNG — those get re-encoded.
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    await uploadAndSendImage(result.assets[0].uri, result.assets[0].base64);
  }, [isLoggedIn, uploadingImage, sending, closeAttachPanel, uploadAndSendImage]);

  const handleTakeAndSendPhoto = useCallback(async () => {
    if (!isLoggedIn || uploadingImage || sending) return;
    closeAttachPanel();
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow camera access to take and send photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    await uploadAndSendImage(result.assets[0].uri, result.assets[0].base64);
  }, [isLoggedIn, uploadingImage, sending, closeAttachPanel, uploadAndSendImage]);

  const handleShareLocation = useCallback(async () => {
    if (sharingLocation) return;
    closeAttachPanel();
    setSharingLocation(true);
    try {
      const result = await getCurrentLocation();
      if (!result.ok) {
        Alert.alert('Could not share location', result.message);
        return;
      }
      const proceed = strategy.confirmLocation
        ? await strategy.confirmLocation(result.location)
        : true;
      if (proceed) await strategy.sendText(formatGeoMessage(result.location));
    } finally {
      setSharingLocation(false);
    }
  }, [sharingLocation, closeAttachPanel, strategy]);

  const handleSendGif = useCallback(
    async (gif: Gif) => {
      setGifPickerOpen(false);
      closeAttachPanel();
      await strategy.sendText(gif.url);
    },
    [closeAttachPanel, strategy, setGifPickerOpen],
  );

  // Share another contact's Nostr profile. Payload mirrors the
  // ContactProfileSheet "Share with friend" format: a human-readable first line
  // plus a NIP-21 `nostr:nprofile…` URI other clients render as a mention.
  const handleShareContactPicked = useCallback(
    async (friend: PickedFriend) => {
      setContactPickerOpen(false);
      closeAttachPanel();
      const readRelays = relays.filter((r) => r.read).map((r) => r.url);
      const relayHints = buildProfileRelayHints(friend.pubkey, contacts, readRelays);
      const nprofile = nprofileEncode(friend.pubkey, relayHints);
      const label = friend.name || 'a contact';
      await strategy.sendText(`Shared contact: ${label}\nnostr:${nprofile}`);
    },
    [closeAttachPanel, contacts, relays, strategy, setContactPickerOpen],
  );

  // Voice-note send (#235): encrypt the recorded .m4a on-device (AES-256-GCM),
  // upload the CIPHERTEXT to Blossom, then send a NIP-17 kind-15 file message.
  const handleSendVoiceNote = useCallback(
    async (uri: string) => {
      if (uploadingVoice) return;
      setUploadingVoice(true);
      try {
        const file = await uploadEncryptedBlob(uri, signEvent, 'audio/mp4');
        const ok = await strategy.sendVoice(file);
        if (!ok) return;
        setVoiceSheetOpen(false);
        closeAttachPanel();
      } catch (error) {
        Alert.alert('Upload failed', error instanceof Error ? error.message : 'Please try again.');
      } finally {
        setUploadingVoice(false);
      }
    },
    [uploadingVoice, signEvent, strategy, setVoiceSheetOpen, closeAttachPanel],
  );

  return {
    sending,
    uploadingImage,
    sharingLocation,
    uploadingVoice,
    handleSend,
    handlePickAndSendImage,
    handleTakeAndSendPhoto,
    handleShareLocation,
    handleSendGif,
    handleShareContactPicked,
    handleSendVoiceNote,
  };
}
