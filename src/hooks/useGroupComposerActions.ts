import React, { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from '../components/BrandedAlert';
import { useNostr, notifyGroupMessage } from '../contexts/NostrContext';
import { appendGroupMessage, type GroupMessage } from '../services/groupMessagesStorageService';
import { stripImageMetadata, uploadImage } from '../services/imageUploadService';
import { getCurrentLocation, formatGeoMessage } from '../services/locationService';
import { nprofileEncode, buildProfileRelayHints } from '../services/nostrService';
import type { PickedFriend } from '../components/FriendPickerSheet';
import type { Gif } from '../services/giphyService';
import type { Group } from '../types/groups';

/**
 * Send / upload / share actions for GroupConversationScreen (#235 onward),
 * plus their in-flight flags. The group sibling of `useConversationComposerActions`:
 * extracted from the screen so it stays focused on layout + wiring (and under the
 * #703 size cap), and so this orchestration — optimistic append, EXIF stripping,
 * Blossom upload, picker dismissal, permission prompts — lives in one place.
 *
 * Everything funnels through `sendText` (the group analog of the 1:1's optimistic
 * send): publish via the context's `sendGroupMessage`, then append a `local_…`
 * row and scroll to it. The hook consumes `useNostr()` directly; the caller passes
 * the screen-owned bits (the group, the composer draft, the message-list setter,
 * a scroll-to-end callback, and the panel/picker setters).
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
  } = params;

  const { sendGroupMessage, pubkey: myPubkey, signEvent, contacts, relays } = useNostr();

  const [sending, setSending] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [sharingLocation, setSharingLocation] = useState(false);

  const closeAttachPanel = useCallback(() => setAttachPanelOpen(false), [setAttachPanelOpen]);

  const sendText = useCallback(
    async (text: string): Promise<boolean> => {
      if (!group || !myPubkey) return false;
      const trimmed = text.trim();
      if (!trimmed) return false;
      setSending(true);
      const result = await sendGroupMessage({
        groupId: group.id,
        subject: group.name,
        memberPubkeys: group.memberPubkeys,
        text: trimmed,
      });
      setSending(false);
      if (!result.success) {
        Alert.alert('Send failed', result.error ?? 'Unknown error');
        return false;
      }
      // Optimistically append locally with a `local_…` id. Duplicate
      // window vs the inbound self-wrap is documented as a known
      // follow-up (see PR #227 round-2 review thread).
      const local: GroupMessage = {
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        senderPubkey: myPubkey,
        text: trimmed,
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
    [group, myPubkey, sendGroupMessage, setMessages, scrollToEnd],
  );

  const handleSend = useCallback(async () => {
    const ok = await sendText(draft);
    if (ok) setDraft('');
  }, [draft, sendText, setDraft]);

  // Attach-panel actions. Each ends by closing the panel and (on success)
  // appending an optimistic local message via sendText. Image and Photo go
  // through imageUploadService (Blossom → URL) and send the URL as the body.
  const uploadAndSend = useCallback(
    async (localUri: string, base64?: string | null) => {
      setUploadingImage(true);
      try {
        const scrubbed = await stripImageMetadata(localUri, base64);
        const url = await uploadImage(scrubbed.uri, signEvent, scrubbed.base64);
        await sendText(url);
      } catch (err) {
        Alert.alert('Upload failed', err instanceof Error ? err.message : 'Please try again.');
      } finally {
        setUploadingImage(false);
      }
    },
    [sendText, signEvent],
  );

  const handlePickAndSendImage = useCallback(async () => {
    if (uploadingImage || sending) return;
    closeAttachPanel();
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to send images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    await uploadAndSend(result.assets[0].uri, result.assets[0].base64);
  }, [uploadingImage, sending, closeAttachPanel, uploadAndSend]);

  const handleTakeAndSendPhoto = useCallback(async () => {
    if (uploadingImage || sending) return;
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
    await uploadAndSend(result.assets[0].uri, result.assets[0].base64);
  }, [uploadingImage, sending, closeAttachPanel, uploadAndSend]);

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
      await sendText(formatGeoMessage(result.location));
    } finally {
      setSharingLocation(false);
    }
  }, [sharingLocation, closeAttachPanel, sendText]);

  const handleSendGif = useCallback(
    async (gif: Gif) => {
      setGifPickerOpen(false);
      closeAttachPanel();
      await sendText(gif.url);
    },
    [closeAttachPanel, sendText, setGifPickerOpen],
  );

  // Share another contact's Nostr profile into the group. Mirrors the 1:1
  // path: "Shared contact: <name>\nnostr:nprofile…" lets other Nostr clients
  // render a tappable profile mention. Sent via the group's own sendText so it
  // shows up in the group thread (not as a DM to the picked contact).
  const handleShareContactPicked = useCallback(
    async (friend: PickedFriend) => {
      setContactPickerOpen(false);
      closeAttachPanel();
      const readRelays = relays.filter((r) => r.read).map((r) => r.url);
      const relayHints = buildProfileRelayHints(friend.pubkey, contacts, readRelays);
      const nprofile = nprofileEncode(friend.pubkey, relayHints);
      const label = friend.name || 'a contact';
      await sendText(`Shared contact: ${label}\nnostr:${nprofile}`);
    },
    [closeAttachPanel, contacts, relays, sendText, setContactPickerOpen],
  );

  // ReceiveSheet hands us the bolt11 via `onSendToGroup`. We post it directly
  // via sendGroupMessage (NOT sendText) because sendText raises its own Alert
  // on failure — ReceiveSheet shows a Toast on failure too, and stacking both
  // reads as a bug. Optimistic local append mirrors sendText.
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
      const local: GroupMessage = {
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        senderPubkey: myPubkey,
        text: payload,
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
      return { success: true };
    },
    [group, myPubkey, sendGroupMessage, setMessages, scrollToEnd],
  );

  return {
    sending,
    uploadingImage,
    sharingLocation,
    sendText,
    handleSend,
    handlePickAndSendImage,
    handleTakeAndSendPhoto,
    handleShareLocation,
    handleSendGif,
    handleShareContactPicked,
    handleSendInvoiceToGroup,
  };
}
