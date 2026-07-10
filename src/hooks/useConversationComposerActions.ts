import React, { useCallback, useMemo } from 'react';
import { Alert } from '../components/BrandedAlert';
import { useNostr } from '../contexts/NostrContext';
import { formatCoordsForDisplay, type SharedLocation } from '../services/locationService';
import { encodeEncryptedFileUrl } from '../utils/encryptedFileUrl';
import type { EncryptedUpload } from '../services/imageUploadService';
import type { ConversationMessageInput } from '../utils/conversationItems';
import { type DeliveryStatus, pendingDelivery, failedDelivery } from '../utils/dmDeliveryStatus';
import { setDmDeliveryStatus } from '../utils/dmDeliveryStore';
import { useComposerActions } from './useComposerActions';
import { NWC_SHARE_KIND, serializeNwcShare, type NwcShareCard } from '../utils/nwcShareMessage';

// Upper bound before the optimistic bubble's pending Clock flips to the red
// failed tick if the send hasn't settled (#857). Past nostr-tools' ~4.4s relay
// publish timeout + TWO publish-level DM_PUBLISH_TIMEOUT_MS windows (8s each —
// the publish layer force-reconnects stale relays and retries once when the
// first attempt lands nothing), with headroom for a slow-but-real accept, so a
// genuine send — including a retried one — still lands delivered.
const SEND_SETTLE_WATCHDOG_MS = 20_000;

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

  const { sendDirectMessage, sendFileMessage, sendNwcShare, appendLocalDmMessage } = useNostr();

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

  // Optimistic send (#857). The bubble paints IMMEDIATELY with a pending Clock,
  // then settles to its final tick when the publish resolves — green single (≥1
  // relay) / double (all relays) / red failed (0 relays). Delivery status lives
  // in an eventId-keyed store (dmDeliveryStore), NOT on the message row, so the
  // ~10s relay-echo `fetchConversation` + `mergeConversationMessages` swapping
  // `local-` → the real eventId can't strip it: the store is keyed by the stable
  // rumor eventId, which is identical on the optimistic row and the echo.
  //
  // The optimistic row's `id` is `local-${rumorId}` (a temporary row id), and
  // the row carries the stable rumor id as `rumorId`. The echo is deduped by
  // text+window in mergeConversationMessages (its id is the OUTER wrap id, not
  // the rumor id — so it's NOT an id-equality swap), and the tick follows the
  // message because the delivery store is keyed by `rumorId`, which both rows
  // share. A failed send keeps the bubble (red tick + Re-publish), and the
  // draft is cleared on send either way (Ben-confirmed standard-messaging
  // behaviour) — retry is via the bubble.
  const sendText = useCallback(
    async (text: string): Promise<boolean> => {
      const createdAt = Math.floor(Date.now() / 1000);
      let eventId: string | null = null;
      // Target relays for THIS send, captured from onRumorReady. Carried onto the
      // pending + watchdog-failed statuses so the message-info sheet lists the
      // relays the send was attempted against even before any settles (or if it
      // hangs and never settles) — without this a pending/hung send showed an
      // empty relay breakdown (the missing-relays bug).
      let targetRelays: string[] = [];
      // Watchdog: if the send hasn't settled the bubble within the window,
      // flip the pending Clock to the red failed tick (#857). This is the
      // authoritative settle guarantee — the underlying publish can hang in
      // ways the publish-level timeout doesn't catch (a relay socket the OS
      // never resolves OR rejects), and the bubble must never be stuck pending
      // forever. A genuine late accept still overrides failed → delivered (the
      // store allows that; it only blocks settled → pending). Seeds the failed
      // status with the target relays so the sheet still lists them as failed.
      const watchdog = setTimeout(() => {
        if (eventId)
          setDmDeliveryStatus(eventId, failedDelivery({ eventId, relays: targetRelays }));
      }, SEND_SETTLE_WATCHDOG_MS);
      try {
        const result = await sendDirectMessage(pubkey, text, {
          onRumorReady: ({ eventId: id, kind, relays }) => {
            eventId = id;
            targetRelays = relays;
            // Paint the pending bubble immediately. The ROW id stays `local-`
            // so mergeConversationMessages' text+window dedup collapses it
            // against the relay echo (whose id is the OUTER wrap id, not this
            // rumor id). The delivery store is keyed by the rumor eventId via
            // `rumorId`, which both this row and the echo carry — so the tick
            // follows the message across the swap. Persisted so the bubble
            // survives a reload.
            const optimistic = {
              id: `local-${id}`,
              rumorId: id,
              fromMe: true,
              text,
              createdAt,
              wireKind: kind,
            };
            setMessages((prev) => [...prev, optimistic]);
            void appendLocalDmMessage(pubkey, optimistic);
            setDmDeliveryStatus(id, pendingDelivery({ eventId: id, kind, relays }));
          },
          onDeliveryFinalized: (delivery) => {
            // Slow relays settled — upgrade the tick (e.g. single → double).
            if (eventId) setDmDeliveryStatus(eventId, delivery);
          },
        });
        // Settle the bubble. `delivery` is present for any send that reached
        // the publish stage; a hard pre-publish error (not logged in, signer
        // cancelled) has none → mark failed so the bubble shows a red tick.
        if (eventId) {
          setDmDeliveryStatus(
            eventId,
            result.delivery ?? failedDelivery({ eventId, relays: targetRelays }),
          );
        } else if (!result.success) {
          // Never reached the rumor stage (e.g. not logged in) — no bubble was
          // painted, so fall back to the alert.
          Alert.alert('Send failed', result.error ?? 'Could not send message.');
        }
        return result.success;
      } finally {
        clearTimeout(watchdog);
      }
    },
    [pubkey, sendDirectMessage, appendLocalDmMessage, setMessages],
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

  // Share an NWC wallet (#431). The connection string is a bearer secret sent
  // ONLY inside the encrypted NIP-17 gift wrap (via `sendNwcShare`). Mirrors
  // `sendFile`: publish first, then append the optimistic "Add NWC Wallet" card
  // on success — the row carries `wireKind: NWC_SHARE_KIND` + the serialized
  // card so `buildConversationItems` rebuilds the card (and the local- row
  // dedupes against the self-wrap echo on the next fetch, which serializes
  // identically). The caller (ConversationScreen) shows the access warning
  // BEFORE invoking this.
  const shareNwcWallet = useCallback(
    async (card: NwcShareCard): Promise<boolean> => {
      const result = await sendNwcShare(pubkey, card);
      if (!result.success) {
        Alert.alert('Could not share wallet', result.error ?? 'Please try again.');
        return false;
      }
      const optimistic = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fromMe: true,
        text: serializeNwcShare(card),
        createdAt: Math.floor(Date.now() / 1000),
        wireKind: NWC_SHARE_KIND,
        deliveryStatus: result.delivery,
      };
      setMessages((prev) => [...prev, optimistic]);
      void appendLocalDmMessage(pubkey, optimistic);
      return true;
    },
    [pubkey, sendNwcShare, setMessages, appendLocalDmMessage],
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
  return { ...actions, appendOptimisticLocal, resendText: sendText, shareNwcWallet };
}
