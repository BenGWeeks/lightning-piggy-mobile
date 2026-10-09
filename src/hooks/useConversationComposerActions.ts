import React, { useCallback, useMemo } from 'react';
import { DEFAULT_DM_PROTOCOL, type DmProtocol } from '../utils/dmProtocol';
import { Alert } from '../components/BrandedAlert';
import { useNostr } from '../contexts/NostrContext';
import { formatCoordsForDisplay, type SharedLocation } from '../services/locationService';
import { encodeEncryptedFileUrl } from '../utils/encryptedFileUrl';
import { uploadEncryptedBlob, type EncryptedUpload } from '../services/imageUploadService';
import type { ConversationMessageInput } from '../utils/conversationItems';
import { type DeliveryStatus, pendingDelivery, failedDelivery } from '../utils/dmDeliveryStatus';
import { setDmDeliveryStatus } from '../utils/dmDeliveryStore';
import { useComposerActions } from './useComposerActions';
import { NWC_SHARE_KIND, serializeNwcShare, type NwcShareCard } from '../utils/nwcShareMessage';
import type { SendHooks, SendResult } from '../contexts/useMessageSend';
import { sendMarmotImage, type MarmotImage } from '../services/marmotSend';

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
  protocol?: DmProtocol;
  pubkey: string;
  name: string;
  draft: string;
  setDraft: (value: string) => void;
  setMessages: React.Dispatch<React.SetStateAction<ConversationMessageInput[]>>;
  setAttachPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setContactPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setGifPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setVoiceSheetOpen: React.Dispatch<React.SetStateAction<boolean>>;
  /** A Marmot send was re-sent over NIP-17 because the peer can't be reached
   *  over Marmot — the screen switches the thread and tells the user. */
  onMarmotFallback?: () => void;
}) {
  const {
    pubkey,
    protocol = DEFAULT_DM_PROTOCOL,
    name,
    draft,
    setDraft,
    setMessages,
    setAttachPanelOpen,
    setContactPickerOpen,
    setGifPickerOpen,
    setVoiceSheetOpen,
    onMarmotFallback,
  } = params;

  const {
    pubkey: myPubkey,
    signEvent,
    sendDirectMessage,
    sendFileMessage,
    sendNwcShare,
    appendLocalDmMessage,
  } = useNostr();

  // Optimistically append a locally-sent row; the relay echo dedups in
  // mergeConversationMessages. Also persisted via appendLocalDmMessage so the
  // delivery tick (#856) survives a thread reload. The `deliveryStatus` rides
  // on the same row — only the local- send copy carries it, never the relay
  // echo, so the persisted tick is authoritative.
  // Marmot rows reuse NIP-17's kinds, so the thread protocol is stored on
  // the row explicitly — without it an optimistic Marmot bubble would be
  // filed under the NIP-17 thread.
  const protocolTag = useMemo(
    () => (protocol === 'marmot' ? { protocol: 'marmot' as const } : {}),
    [protocol],
  );

  const appendOptimisticLocal = useCallback(
    (text: string, deliveryStatus?: DeliveryStatus) => {
      const optimistic = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fromMe: true,
        text,
        createdAt: Math.floor(Date.now() / 1000),
        deliveryStatus,
        ...protocolTag,
      };
      setMessages((prev) => [...prev, optimistic]);
      void appendLocalDmMessage(pubkey, optimistic);
    },
    [appendLocalDmMessage, pubkey, setMessages, protocolTag],
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
  // `send` runs the actual publish; its `onRumorReady` may carry the row text
  // when the sender builds it (a Marmot photo's `#lpe=1` URL), else `text`.
  const sendWithBubble = useCallback(
    async (
      text: string,
      sendProtocol: DmProtocol,
      send: (
        hooks: Required<Pick<SendHooks, 'onDeliveryFinalized'>> & {
          onRumorReady: (meta: {
            eventId: string;
            kind: number;
            relays: string[];
            text?: string;
          }) => void;
        },
      ) => Promise<SendResult>,
      // Run instead of the failure alert when the peer can't be reached over
      // Marmot (no usable key package) — re-sends over NIP-17.
      fallback?: () => Promise<boolean>,
    ): Promise<boolean> => {
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
        const result = await send({
          onRumorReady: ({ eventId: id, kind, relays, text: rowText }) => {
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
              text: rowText ?? text,
              // Stamped when the rumor is built, not when the send began: a
              // photo's upload can take a while, and a stale time would fall
              // outside the echo-dedup window and leave a duplicate bubble.
              createdAt: Math.floor(Date.now() / 1000),
              wireKind: kind,
              ...(sendProtocol === 'marmot' ? { protocol: 'marmot' as const } : {}),
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
          if (result.marmotUnreachable && fallback) return fallback();
          // Never reached the rumor stage (e.g. not logged in) — no bubble was
          // painted, so fall back to the alert.
          Alert.alert('Send failed', result.error ?? 'Could not send message.');
        }
        return result.success;
      } finally {
        clearTimeout(watchdog);
      }
    },
    [pubkey, appendLocalDmMessage, setMessages],
  );

  // Someone Marmot can't reach (no key package, or a legacy one the classic
  // White Noise app still publishes) still gets the message: re-send it over
  // NIP-17, then the screen moves the thread there.
  const viaNip17 = useCallback(
    async (send: () => Promise<boolean>): Promise<boolean> => {
      const ok = await send();
      if (ok) onMarmotFallback?.();
      return ok;
    },
    [onMarmotFallback],
  );

  const sendText = useCallback(
    (text: string, sendProtocol: DmProtocol = protocol) => {
      const send = (p: DmProtocol): Promise<boolean> =>
        sendWithBubble(
          text,
          p,
          (hooks) => sendDirectMessage(pubkey, text, { protocol: p, ...hooks }),
          p === 'marmot' ? () => viaNip17(() => send('nip17')) : undefined,
        );
      return send(sendProtocol);
    },
    [protocol, pubkey, sendDirectMessage, sendWithBubble, viaNip17],
  );

  const sendFile = useCallback(
    async (
      file: EncryptedUpload,
      kind: 'voice' | 'image',
      sendProtocol: DmProtocol = protocol,
    ): Promise<boolean> => {
      const result = await sendFileMessage(pubkey, file, sendProtocol);
      if (!result.success && result.marmotUnreachable && sendProtocol === 'marmot') {
        return viaNip17(() => sendFile(file, kind, 'nip17'));
      }
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
        ...(sendProtocol === 'marmot' ? { protocol: 'marmot' as const } : {}),
      };
      setMessages((prev) => [...prev, optimistic]);
      void appendLocalDmMessage(pubkey, optimistic);
      return true;
    },
    [pubkey, sendFileMessage, setMessages, appendLocalDmMessage, protocol, viaNip17],
  );

  // Marmot photos go the Marmot way (MIP-04) so White Noise and other Marmot
  // clients can show them; NIP-17 / NIP-04 threads keep the kind-15 upload.
  const sendImage = useCallback(
    (image: MarmotImage) =>
      sendWithBubble(
        '',
        'marmot',
        (hooks) =>
          myPubkey
            ? sendMarmotImage(myPubkey, { peer: pubkey }, image, signEvent, hooks)
            : Promise.resolve({ success: false, error: 'Not signed in' }),
        () =>
          viaNip17(async () =>
            sendFile(
              await uploadEncryptedBlob(image.uri, signEvent, image.mime, image.base64),
              'image',
              'nip17',
            ),
          ),
      ),
    [myPubkey, pubkey, signEvent, sendWithBubble, sendFile, viaNip17],
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
      const result = await sendNwcShare(pubkey, card, protocol);
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
        ...protocolTag,
      };
      setMessages((prev) => [...prev, optimistic]);
      void appendLocalDmMessage(pubkey, optimistic);
      return true;
    },
    [pubkey, sendNwcShare, setMessages, appendLocalDmMessage, protocol, protocolTag],
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
  // Attachments (GIF / location / contact) on a NIP-04 thread upgrade to
  // NIP-17; a Marmot thread keeps them inside its MLS group.
  const sendAttachmentText = useCallback(
    (text: string) => sendText(text, protocol === 'marmot' ? 'marmot' : 'nip17'),
    [sendText, protocol],
  );
  const strategy = useMemo(
    () => ({
      sendText: sendAttachmentText,
      sendMessage: sendText,
      sendFile,
      ...(protocol === 'marmot' ? { sendImage, gifEnvelope: true } : {}),
      confirmLocation,
    }),
    [sendAttachmentText, sendText, sendFile, sendImage, protocol, confirmLocation],
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
