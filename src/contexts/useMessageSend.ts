import { useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as nostrService from '../services/nostrService';
import * as amberService from '../services/amberService';
import * as nostrConnectService from '../services/nostrConnectService';
import { NSEC_KEY } from './nostrAuthKeys';
import { createFileMessageRumor } from '../services/nostrFileMessage';
import { directMessageRumorEventId } from '../services/dmRumorId';
import { NWC_SHARE_KIND, serializeNwcShare, type NwcShareCard } from '../utils/nwcShareMessage';
import type { EncryptedUpload } from '../services/imageUploadService';
import type { DmSendResult } from '../services/nostrService';
import type { SignerType, RelayConfig } from '../types/nostr';
import type { DeliveryStatus } from '../utils/dmDeliveryStatus';

// A send carries the per-relay delivery breakdown so the optimistic bubble can
// show its tick and persist it (#856). `success` means the send FULLY delivered
// — every intended wrap published and no signer/publish errors — and drives
// whether the composer clears the draft; a partial send (e.g. self-wrap landed
// but the recipient wrap failed) is NOT success, so the draft is kept for
// Re-publish (see `toTextSendResult`). `delivery` is present for any send that
// reached the publish stage (delivered / partial / all-failed alike), so the
// optimistic bubble can settle to its final tick; only a hard pre-publish error
// (not logged in, signer cancelled) omits it (#857).
export interface SendResult {
  success: boolean;
  error?: string;
  delivery?: DeliveryStatus;
}

// Early/late hooks for the optimistic-send flow (#857). `onRumorReady` fires
// synchronously once the stable rumor eventId is known (before publishing), so
// the caller can paint the pending bubble keyed by it. It also carries the
// `relays` the send is going out to, so the pending/failed status can seed its
// relay breakdown for the info sheet even before any relay settles (so a still-
// pending or hung send still lists its relays). `onDeliveryFinalized` fires
// later with the COMPLETE per-relay breakdown after all relays settle.
export interface SendHooks {
  onRumorReady?: (meta: { eventId: string; kind: number; relays: string[] }) => void;
  onDeliveryFinalized?: (delivery: DeliveryStatus) => void;
}

/**
 * NIP-17 message-send hook (#235, #227). Holds the three outbound paths —
 * 1:1 text, 1:1 encrypted file (voice note), and group — extracted from
 * NostrContext so that file (over the 1,000-line cap, #703) stays under
 * baseline. Pure send logic: each method closes over only the four values
 * passed in, so the hook is a thin, dependency-explicit slice of the
 * provider. Both nsec (signs locally) and Amber (per-recipient signEvent +
 * nip44Encrypt round-trips) signers are supported.
 */
export interface UseMessageSendParams {
  pubkey: string | null;
  isLoggedIn: boolean;
  signerType: SignerType | null;
  relays: RelayConfig[];
}

// Map a NIP-17 multi-wrap send result to the composer's success/draft outcome.
//
// A 1:1 send always fans out a self-wrap + a recipient wrap. `delivery.delivered`
// only means SOME wrap reached SOME relay, so it can be `true` when just the
// self-wrap landed but the recipient wrap was never signed (signer cancelled /
// denied after the first seal — see the sequential loop in
// `sendNip17ToManyWithSigner`) or never accepted by any relay. Gating `success`
// on `delivered` would then clear the composer for a message the recipient never
// received. Instead require the strict partial-send test the file-message path
// below already uses: at least one wrap published AND no signer/publish errors.
// `delivery` is still returned in every case so the optimistic bubble settles to
// its final tick and a partial/failed send keeps the draft for Re-publish
// (#857; Copilot review on #283).
function toTextSendResult(result: DmSendResult): SendResult {
  const fullyDelivered = result.wrapsPublished > 0 && result.errors.length === 0;
  return {
    success: fullyDelivered,
    delivery: result.delivery,
    error: fullyDelivered ? undefined : (result.errors[0] ?? 'Send failed'),
  };
}

export function useMessageSend({ pubkey, isLoggedIn, signerType, relays }: UseMessageSendParams) {
  const sendDirectMessage = useCallback(
    async (recipientPubkey: string, plaintext: string, hooks?: SendHooks): Promise<SendResult> => {
      if (!pubkey || !isLoggedIn) {
        return { success: false, error: 'Not logged in' };
      }
      const normalizedRecipientPubkey = recipientPubkey.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(normalizedRecipientPubkey)) {
        return { success: false, error: 'Invalid public key format' };
      }
      // Union the user's published write relays with DEFAULT_RELAYS. Publish
      // uses Promise.any, so one responsive relay is enough — but a user
      // whose NIP-65 list has a single entry (and no in-app UI to edit it)
      // hits a single-point failure the moment that relay is slow.
      const writeRelays = relays.filter((r) => r.write).map((r) => r.url);
      const targetRelays = Array.from(new Set([...writeRelays, ...nostrService.DEFAULT_RELAYS]));
      try {
        const rumor = nostrService.createDirectMessageRumor({
          senderPubkey: pubkey,
          recipientPubkey: normalizedRecipientPubkey,
          content: plaintext,
        });
        // Stable rumor id — identical on the relay echo — keys the delivery
        // store so the optimistic bubble can be painted before publishing and
        // settled after, surviving the local- → echo id swap (#857).
        const eventId = directMessageRumorEventId(rumor);
        hooks?.onRumorReady?.({ eventId, kind: rumor.kind, relays: targetRelays });

        if (signerType === 'nsec') {
          const nsec = await SecureStore.getItemAsync(NSEC_KEY);
          if (!nsec) return { success: false, error: 'Key not found' };
          const { secretKey } = nostrService.decodeNsec(nsec);
          const result = await nostrService.sendNip17ToManyWithNsec({
            senderSecretKey: secretKey,
            rumor,
            recipientPubkeys: [normalizedRecipientPubkey],
            relays: targetRelays,
            onDeliveryFinalized: hooks?.onDeliveryFinalized,
          });
          // Return the per-relay delivery so the bubble can settle to its final
          // tick (delivered / partial / all-failed); `toTextSendResult` gates
          // `success` (composer-clear) on a fully-delivered send so a partial one
          // keeps the draft for Re-publish — no silent drop (#857).
          return toTextSendResult(result);
        }

        if (signerType === 'amber') {
          const currentUser = pubkey;
          const result = await nostrService.sendNip17ToManyWithSigner({
            senderPubkey: currentUser,
            rumor,
            recipientPubkeys: [normalizedRecipientPubkey],
            relays: targetRelays,
            onDeliveryFinalized: hooks?.onDeliveryFinalized,
            signerNip44Encrypt: (plain, recipient) =>
              amberService.requestNip44Encrypt(plain, recipient, currentUser),
            signerSignSeal: async (unsignedSeal) => {
              // Keep pubkey on the seal — Amber misroutes kind=13 sign_event Intents without it (#356) and lands on its main Apps screen instead of the Sign Event sheet. Same rule as the group-send Amber path further down.
              const { event: signedEventJson } = await amberService.requestEventSignature(
                JSON.stringify(unsignedSeal),
                '',
                currentUser,
              );
              if (!signedEventJson) {
                throw new Error('Amber returned empty signed seal');
              }
              return JSON.parse(signedEventJson);
            },
          });
          return toTextSendResult(result);
        }

        if (signerType === 'nip46') {
          // NIP-17 send over NIP-46. Same Encrypt → SignSeal → Publish
          // shape as the Amber path, just over a relay round-trip
          // instead of an Android Intent. `requestEventSignature`
          // strips pubkey/id/sig internally to build the EventTemplate
          // the BunkerSigner expects, so we can hand it the full seal.
          const currentUser = pubkey;
          const result = await nostrService.sendNip17ToManyWithSigner({
            senderPubkey: currentUser,
            rumor,
            recipientPubkeys: [normalizedRecipientPubkey],
            relays: targetRelays,
            onDeliveryFinalized: hooks?.onDeliveryFinalized,
            signerNip44Encrypt: (plain, recipient) =>
              nostrConnectService.requestNip44Encrypt(plain, recipient, currentUser),
            signerSignSeal: async (unsignedSeal) => {
              const { event: signedEventJson } = await nostrConnectService.requestEventSignature(
                JSON.stringify(unsignedSeal),
                '',
                currentUser,
              );
              if (!signedEventJson) {
                throw new Error('NIP-46 signer returned empty signed seal');
              }
              return JSON.parse(signedEventJson);
            },
          });
          return toTextSendResult(result);
        }

        return { success: false, error: 'Unsupported signer type' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send message';
        return { success: false, error: message };
      }
    },
    [pubkey, isLoggedIn, signerType, relays],
  );

  // Gift-wrap a pre-built NIP-17 rumor of ANY inner kind to one or more
  // recipients (#203 structured polls). Mirrors `sendDirectMessage` but the
  // caller supplies the rumor (a kind-1068 poll / kind-1018 vote) so its
  // structured tags survive to the wire — `sendDirectMessage` only knows how to
  // build a kind-14 chat rumor. The sender is always included by
  // `wrapManyEvents`, so a 1:1 vote to `[author]` still lands the voter's own
  // self-copy for their optimistic tally.
  const sendDirectRumor = useCallback(
    async (
      recipientPubkeys: string[],
      rumor: {
        kind: number;
        created_at: number;
        tags: string[][];
        content: string;
        pubkey: string;
      },
      hooks?: SendHooks,
    ): Promise<SendResult> => {
      if (!pubkey || !isLoggedIn) {
        return { success: false, error: 'Not logged in' };
      }
      const normalized = Array.from(
        new Set(
          recipientPubkeys
            .map((p) => p.trim().toLowerCase())
            .filter((p) => /^[0-9a-f]{64}$/.test(p)),
        ),
      );
      if (normalized.length === 0) {
        return { success: false, error: 'No valid recipients' };
      }
      const writeRelays = relays.filter((r) => r.write).map((r) => r.url);
      const targetRelays = Array.from(new Set([...writeRelays, ...nostrService.DEFAULT_RELAYS]));
      try {
        const eventId = directMessageRumorEventId(rumor);
        hooks?.onRumorReady?.({ eventId, kind: rumor.kind, relays: targetRelays });

        if (signerType === 'nsec') {
          const nsec = await SecureStore.getItemAsync(NSEC_KEY);
          if (!nsec) return { success: false, error: 'Key not found' };
          const { secretKey } = nostrService.decodeNsec(nsec);
          const result = await nostrService.sendNip17ToManyWithNsec({
            senderSecretKey: secretKey,
            rumor,
            recipientPubkeys: normalized,
            relays: targetRelays,
            onDeliveryFinalized: hooks?.onDeliveryFinalized,
          });
          return {
            success: result.delivery.delivered,
            delivery: result.delivery,
            error: result.delivery.delivered ? undefined : (result.errors[0] ?? 'Send failed'),
          };
        }

        if (signerType === 'amber') {
          const currentUser = pubkey;
          const result = await nostrService.sendNip17ToManyWithSigner({
            senderPubkey: currentUser,
            rumor,
            recipientPubkeys: normalized,
            relays: targetRelays,
            onDeliveryFinalized: hooks?.onDeliveryFinalized,
            signerNip44Encrypt: (plain, recipient) =>
              amberService.requestNip44Encrypt(plain, recipient, currentUser),
            signerSignSeal: async (unsignedSeal) => {
              const { event: signedEventJson } = await amberService.requestEventSignature(
                JSON.stringify(unsignedSeal),
                '',
                currentUser,
              );
              if (!signedEventJson) {
                throw new Error('Amber returned empty signed seal');
              }
              return JSON.parse(signedEventJson);
            },
          });
          return {
            success: result.delivery.delivered,
            delivery: result.delivery,
            error: result.delivery.delivered ? undefined : (result.errors[0] ?? 'Send failed'),
          };
        }

        return { success: false, error: 'Unsupported signer type' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send';
        return { success: false, error: message };
      }
    },
    [pubkey, isLoggedIn, signerType, relays],
  );

  // Encrypted NIP-17 kind-15 file message (voice note, #235). The blob is
  // already encrypted + uploaded; this gift-wraps the URL + AES key/nonce
  // to the recipient (and the sender's own inbox copy).
  const sendFileMessage = useCallback(
    async (recipientPubkey: string, file: EncryptedUpload): Promise<SendResult> => {
      if (!pubkey || !isLoggedIn) {
        return { success: false, error: 'Not logged in' };
      }
      const normalizedRecipientPubkey = recipientPubkey.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(normalizedRecipientPubkey)) {
        return { success: false, error: 'Invalid public key format' };
      }
      const writeRelays = relays.filter((r) => r.write).map((r) => r.url);
      const targetRelays = Array.from(new Set([...writeRelays, ...nostrService.DEFAULT_RELAYS]));
      try {
        const rumor = createFileMessageRumor({
          senderPubkey: pubkey,
          recipientPubkey: normalizedRecipientPubkey,
          url: file.url,
          mime: file.mime,
          keyHex: file.keyHex,
          nonceHex: file.nonceHex,
          sha256Hex: file.sha256Hex,
          size: file.size,
        });

        if (signerType === 'nsec') {
          const nsec = await SecureStore.getItemAsync(NSEC_KEY);
          if (!nsec) return { success: false, error: 'Key not found' };
          const { secretKey } = nostrService.decodeNsec(nsec);
          const result = await nostrService.sendNip17ToManyWithNsec({
            senderSecretKey: secretKey,
            rumor,
            recipientPubkeys: [normalizedRecipientPubkey],
            relays: targetRelays,
          });
          if (result.wrapsPublished === 0) {
            return { success: false, error: result.errors[0] ?? 'No wraps published' };
          }
          if (result.errors.length > 0) {
            const intended = result.wrapsPublished + result.errors.length;
            return {
              success: false,
              error: `Send incomplete — published ${result.wrapsPublished} of ${intended} wraps. ${result.errors[0]}`,
            };
          }
          return { success: true, delivery: result.delivery };
        }

        if (signerType === 'amber') {
          const currentUser = pubkey;
          const result = await nostrService.sendNip17ToManyWithSigner({
            senderPubkey: currentUser,
            rumor,
            recipientPubkeys: [normalizedRecipientPubkey],
            relays: targetRelays,
            signerNip44Encrypt: (plain, recipient) =>
              amberService.requestNip44Encrypt(plain, recipient, currentUser),
            signerSignSeal: async (unsignedSeal) => {
              const { event: signedEventJson } = await amberService.requestEventSignature(
                JSON.stringify(unsignedSeal),
                '',
                currentUser,
              );
              if (!signedEventJson) {
                throw new Error('Amber returned empty signed seal');
              }
              return JSON.parse(signedEventJson);
            },
          });
          if (result.wrapsPublished === 0) {
            return { success: false, error: result.errors[0] ?? 'No wraps published' };
          }
          if (result.errors.length > 0) {
            const intended = result.wrapsPublished + result.errors.length;
            return {
              success: false,
              error: `Send incomplete — published ${result.wrapsPublished} of ${intended} wraps. ${result.errors[0]}`,
            };
          }
          return { success: true, delivery: result.delivery };
        }

        if (signerType === 'nip46') {
          const currentUser = pubkey;
          const result = await nostrService.sendNip17ToManyWithSigner({
            senderPubkey: currentUser,
            rumor,
            recipientPubkeys: [normalizedRecipientPubkey],
            relays: targetRelays,
            signerNip44Encrypt: (plain, recipient) =>
              nostrConnectService.requestNip44Encrypt(plain, recipient, currentUser),
            signerSignSeal: async (unsignedSeal) => {
              const { event: signedEventJson } = await nostrConnectService.requestEventSignature(
                JSON.stringify(unsignedSeal),
                '',
                currentUser,
              );
              if (!signedEventJson) {
                throw new Error('NIP-46 signer returned empty signed seal');
              }
              return JSON.parse(signedEventJson);
            },
          });
          if (result.wrapsPublished === 0) {
            return { success: false, error: result.errors[0] ?? 'No wraps published' };
          }
          if (result.errors.length > 0) {
            const intended = result.wrapsPublished + result.errors.length;
            return {
              success: false,
              error: `Send incomplete — published ${result.wrapsPublished} of ${intended} wraps. ${result.errors[0]}`,
            };
          }
          return { success: true, delivery: result.delivery };
        }

        return { success: false, error: 'Unsupported signer type' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send file';
        return { success: false, error: message };
      }
    },
    [pubkey, isLoggedIn, signerType, relays],
  );

  // Share an NWC wallet (#431). The NWC connection string is a BEARER SECRET,
  // so it goes out ONLY inside a NIP-17 gift wrap (the same encrypted, peer-only
  // path as every DM) — never a public/plaintext event. The inner rumor carries
  // the app-specific `NWC_SHARE_KIND` with the share JSON as content; the
  // recipient's client rebuilds an "Add NWC Wallet" card from it. Mirrors
  // `sendFileMessage` (no delivery-tick hooks — the card has no tick UI).
  const sendNwcShare = useCallback(
    async (recipientPubkey: string, card: NwcShareCard): Promise<SendResult> => {
      if (!pubkey || !isLoggedIn) {
        return { success: false, error: 'Not logged in' };
      }
      const normalizedRecipientPubkey = recipientPubkey.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(normalizedRecipientPubkey)) {
        return { success: false, error: 'Invalid public key format' };
      }
      const writeRelays = relays.filter((r) => r.write).map((r) => r.url);
      const targetRelays = Array.from(new Set([...writeRelays, ...nostrService.DEFAULT_RELAYS]));
      try {
        const rumor = {
          pubkey,
          kind: NWC_SHARE_KIND,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['p', normalizedRecipientPubkey]],
          content: serializeNwcShare(card),
        };

        if (signerType === 'nsec') {
          const nsec = await SecureStore.getItemAsync(NSEC_KEY);
          if (!nsec) return { success: false, error: 'Key not found' };
          const { secretKey } = nostrService.decodeNsec(nsec);
          const result = await nostrService.sendNip17ToManyWithNsec({
            senderSecretKey: secretKey,
            rumor,
            recipientPubkeys: [normalizedRecipientPubkey],
            relays: targetRelays,
          });
          // Strict success: at least one wrap published AND no signer/publish
          // errors — `delivery.delivered` alone can be true when only the
          // self-wrap landed but the recipient wrap failed, which would wrongly
          // claim "Wallet shared" (Copilot review on #431).
          return toTextSendResult(result);
        }

        if (signerType === 'amber') {
          const currentUser = pubkey;
          const result = await nostrService.sendNip17ToManyWithSigner({
            senderPubkey: currentUser,
            rumor,
            recipientPubkeys: [normalizedRecipientPubkey],
            relays: targetRelays,
            signerNip44Encrypt: (plain, recipient) =>
              amberService.requestNip44Encrypt(plain, recipient, currentUser),
            signerSignSeal: async (unsignedSeal) => {
              const { event: signedEventJson } = await amberService.requestEventSignature(
                JSON.stringify(unsignedSeal),
                '',
                currentUser,
              );
              if (!signedEventJson) {
                throw new Error('Amber returned empty signed seal');
              }
              return JSON.parse(signedEventJson);
            },
          });
          return toTextSendResult(result);
        }

        if (signerType === 'nip46') {
          // NIP-17 share over NIP-46 — same Encrypt → SignSeal → Publish shape
          // as the Amber path, over a relay round-trip instead of an Android
          // Intent. Mirrors `sendDirectMessage`'s nip46 branch so Wallet Share
          // works for users logged in via a remote signer (Copilot review on #431).
          const currentUser = pubkey;
          const result = await nostrService.sendNip17ToManyWithSigner({
            senderPubkey: currentUser,
            rumor,
            recipientPubkeys: [normalizedRecipientPubkey],
            relays: targetRelays,
            signerNip44Encrypt: (plain, recipient) =>
              nostrConnectService.requestNip44Encrypt(plain, recipient, currentUser),
            signerSignSeal: async (unsignedSeal) => {
              const { event: signedEventJson } = await nostrConnectService.requestEventSignature(
                JSON.stringify(unsignedSeal),
                '',
                currentUser,
              );
              if (!signedEventJson) {
                throw new Error('NIP-46 signer returned empty signed seal');
              }
              return JSON.parse(signedEventJson);
            },
          });
          return toTextSendResult(result);
        }

        return { success: false, error: 'Unsupported signer type' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to share wallet';
        return { success: false, error: message };
      }
    },
    [pubkey, isLoggedIn, signerType, relays],
  );

  return { sendDirectMessage, sendDirectRumor, sendFileMessage, sendNwcShare };
}
