import { useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as nostrService from '../services/nostrService';
import * as amberService from '../services/amberService';
import { NSEC_KEY } from './nostrAuthKeys';
import { createFileMessageRumor } from '../services/nostrFileMessage';
import type { EncryptedUpload } from '../services/imageUploadService';
import type { SignerType, RelayConfig } from '../types/nostr';

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

export function useMessageSend({ pubkey, isLoggedIn, signerType, relays }: UseMessageSendParams) {
  const sendDirectMessage = useCallback(
    async (
      recipientPubkey: string,
      plaintext: string,
    ): Promise<{ success: boolean; error?: string }> => {
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
          // Partial send — at least one wrap (recipient delivery and/or sender's own inbox copy) failed to publish. Surface as non-fatal failure so the composer keeps its draft and the user can retry, mirroring sendGroupMessage's pattern.
          if (result.errors.length > 0) {
            const intended = result.wrapsPublished + result.errors.length;
            return {
              success: false,
              error: `Send incomplete — published ${result.wrapsPublished} of ${intended} wraps. ${result.errors[0]}`,
            };
          }
          return { success: true };
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
          if (result.wrapsPublished === 0) {
            return { success: false, error: result.errors[0] ?? 'No wraps published' };
          }
          // Same partial-send handling as the nsec path. Amber's per-recipient sequential signing means a cancelled prompt or a failed seal mid-loop leaves earlier wraps published but later ones unsent — surface that to the user instead of silent success.
          if (result.errors.length > 0) {
            const intended = result.wrapsPublished + result.errors.length;
            return {
              success: false,
              error: `Send incomplete — published ${result.wrapsPublished} of ${intended} wraps. ${result.errors[0]}`,
            };
          }
          return { success: true };
        }

        return { success: false, error: 'Unsupported signer type' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send message';
        return { success: false, error: message };
      }
    },
    [pubkey, isLoggedIn, signerType, relays],
  );

  // Encrypted NIP-17 kind-15 file message (voice note, #235). The blob is
  // already encrypted + uploaded; this gift-wraps the URL + AES key/nonce
  // to the recipient (and the sender's own inbox copy).
  const sendFileMessage = useCallback(
    async (
      recipientPubkey: string,
      file: EncryptedUpload,
    ): Promise<{ success: boolean; error?: string }> => {
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
          return { success: true };
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
          return { success: true };
        }

        return { success: false, error: 'Unsupported signer type' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send file';
        return { success: false, error: message };
      }
    },
    [pubkey, isLoggedIn, signerType, relays],
  );

  return { sendDirectMessage, sendFileMessage };
}
