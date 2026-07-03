import { useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as nostrService from '../services/nostrService';
import * as amberService from '../services/amberService';
import * as nostrConnectService from '../services/nostrConnectService';
import { createGroupFileRumor } from '../services/nostrFileMessage';
import type { EncryptedUpload } from '../services/imageUploadService';
import type { RelayConfig, SignerType } from '../types/nostr';
import { NSEC_KEY } from './nostrAuthKeys';

/**
 * Provider-owned slices the group-messaging callbacks close over: the
 * active identity (`pubkey`, `isLoggedIn`, `signerType`) and the merged
 * relay list (`relays`). Threading them in keeps the extracted logic
 * byte-for-byte equivalent to the inline provider version.
 */
export interface UseGroupMessagingOptions {
  pubkey: string | null;
  isLoggedIn: boolean;
  signerType: SignerType | null;
  relays: RelayConfig[];
}

/**
 * The two group callbacks the provider re-exposes through the context
 * value: a NIP-17 group send and the kind-30200 group-state publish.
 */
export interface UseGroupMessagingResult {
  sendGroupMessage: (input: {
    groupId: string;
    subject: string;
    memberPubkeys: string[];
    /** Text body. Optional when sending a `file` (kind-15) message. */
    text?: string;
    /** When set, sends an encrypted NIP-17 kind-15 group file message
     *  (e.g. a voice note, #235) instead of a kind-14 chat message. */
    file?: EncryptedUpload;
  }) => Promise<{ success: boolean; wrapsPublished?: number; error?: string }>;
  publishGroupState: (input: {
    groupId: string;
    name: string;
    memberPubkeys: string[];
  }) => Promise<{ success: boolean; error?: string }>;
}

export function useGroupMessaging(options: UseGroupMessagingOptions): UseGroupMessagingResult {
  const { pubkey, isLoggedIn, signerType, relays } = options;

  /**
   * NIP-17 multi-recipient send. Supports both nsec (signs locally) and
   * Amber (per-recipient signEvent + nip44Encrypt round-trips) signers.
   *
   * Amber path is sequential by design — the native module rejects
   * concurrent intents with `BUSY` (see modules/amber-signer/.../
   * AmberSignerModule.kt → launchIntent). With N recipients (+1 for the
   * sender's own inbox copy), this fires up to 2N Amber prompts unless
   * the user has pre-granted blanket permission for `sign_event` and
   * `nip44_encrypt`, in which case Amber's ContentResolver fast-path
   * resolves silently. See issue #247.
   */
  const sendGroupMessage = useCallback(
    async (input: {
      groupId: string;
      subject: string;
      memberPubkeys: string[];
      text?: string;
      file?: EncryptedUpload;
    }): Promise<{ success: boolean; wrapsPublished?: number; error?: string }> => {
      if (!pubkey || !isLoggedIn) return { success: false, error: 'Not logged in' };
      const text = (input.text ?? '').trim();
      if (!input.file && !text) return { success: false, error: 'Empty message' };
      const writeRelays = relays.filter((r) => r.write).map((r) => r.url);
      const targetRelays = Array.from(new Set([...writeRelays, ...nostrService.DEFAULT_RELAYS]));
      try {
        // kind-15 encrypted file (voice note, #235) when a `file` is given;
        // otherwise the standard kind-14 group chat rumor.
        const rumor = input.file
          ? createGroupFileRumor({
              senderPubkey: pubkey,
              subject: input.subject,
              memberPubkeys: input.memberPubkeys,
              url: input.file.url,
              mime: input.file.mime,
              keyHex: input.file.keyHex,
              nonceHex: input.file.nonceHex,
              sha256Hex: input.file.sha256Hex,
              size: input.file.size,
            })
          : nostrService.createGroupChatRumor({
              senderPubkey: pubkey,
              subject: input.subject,
              memberPubkeys: input.memberPubkeys,
              content: text,
            });

        if (signerType === 'nsec') {
          const nsec = await SecureStore.getItemAsync(NSEC_KEY);
          if (!nsec) return { success: false, error: 'Key not found' };
          const { secretKey } = nostrService.decodeNsec(nsec);
          const result = await nostrService.sendNip17ToManyWithNsec({
            senderSecretKey: secretKey,
            rumor,
            recipientPubkeys: input.memberPubkeys,
            relays: targetRelays,
          });
          if (result.wrapsPublished === 0) {
            return { success: false, error: result.errors[0] ?? 'No wraps published' };
          }
          // Partial send — some recipients got the message, others didn't
          // (typically the user cancelled an Amber prompt mid-loop, or
          // a relay rejected one wrap). Surface this as a non-fatal
          // failure rather than silent success so the composer doesn't
          // clear and the user sees how many members actually received it.
          if (result.errors.length > 0) {
            const intended = result.wrapsPublished + result.errors.length;
            return {
              success: false,
              wrapsPublished: result.wrapsPublished,
              error: `Sent to ${result.wrapsPublished} of ${intended} members. ${result.errors[0]}`,
            };
          }
          return { success: true, wrapsPublished: result.wrapsPublished };
        }

        if (signerType === 'amber') {
          const currentUser = pubkey;
          const result = await nostrService.sendNip17ToManyWithSigner({
            senderPubkey: currentUser,
            rumor,
            recipientPubkeys: input.memberPubkeys,
            relays: targetRelays,
            signerNip44Encrypt: (plaintext, recipientPubkey) =>
              amberService.requestNip44Encrypt(plaintext, recipientPubkey, currentUser),
            signerSignSeal: async (unsignedSeal) => {
              // Keep pubkey on the seal — Amber misroutes kind=13 sign_event Intents without it (#356).
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
          // Partial send — some recipients got the message, others didn't
          // (typically the user cancelled an Amber prompt mid-loop, or
          // a relay rejected one wrap). Surface this as a non-fatal
          // failure rather than silent success so the composer doesn't
          // clear and the user sees how many members actually received it.
          if (result.errors.length > 0) {
            const intended = result.wrapsPublished + result.errors.length;
            return {
              success: false,
              wrapsPublished: result.wrapsPublished,
              error: `Sent to ${result.wrapsPublished} of ${intended} members. ${result.errors[0]}`,
            };
          }
          return { success: true, wrapsPublished: result.wrapsPublished };
        }

        if (signerType === 'nip46') {
          // NIP-46 group send. Mirrors the Amber path's shape exactly —
          // including the partial-send-as-failure semantics — but routes
          // per-recipient nip44_encrypt + seal-sign calls through the
          // bunker instead of an Android Intent. Each recipient costs 2
          // bunker round-trips, so a large group can take several
          // seconds; the composer shows a spinner while this runs.
          const currentUser = pubkey;
          const result = await nostrService.sendNip17ToManyWithSigner({
            senderPubkey: currentUser,
            rumor,
            recipientPubkeys: input.memberPubkeys,
            relays: targetRelays,
            signerNip44Encrypt: (plaintext, recipientPubkey) =>
              nostrConnectService.requestNip44Encrypt(plaintext, recipientPubkey, currentUser),
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
              wrapsPublished: result.wrapsPublished,
              error: `Sent to ${result.wrapsPublished} of ${intended} members. ${result.errors[0]}`,
            };
          }
          return { success: true, wrapsPublished: result.wrapsPublished };
        }

        return { success: false, error: 'Unsupported signer type' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send group message';
        return { success: false, error: message };
      }
    },
    [pubkey, isLoggedIn, signerType, relays],
  );

  /**
   * Publish a kind-30200 group-state event. Single signEvent call —
   * trivially safe for Amber (no per-recipient fan-out, no concurrency).
   */
  const publishGroupState = useCallback(
    async (input: {
      groupId: string;
      name: string;
      memberPubkeys: string[];
    }): Promise<{ success: boolean; error?: string }> => {
      if (!pubkey || !isLoggedIn) return { success: false, error: 'Not logged in' };
      const writeRelays = relays.filter((r) => r.write).map((r) => r.url);
      const targetRelays = Array.from(new Set([...writeRelays, ...nostrService.DEFAULT_RELAYS]));
      try {
        const event = nostrService.createGroupStateEvent({
          groupId: input.groupId,
          name: input.name,
          memberPubkeys: input.memberPubkeys,
        });

        if (signerType === 'nsec') {
          const nsec = await SecureStore.getItemAsync(NSEC_KEY);
          if (!nsec) return { success: false, error: 'Key not found' };
          const { secretKey } = nostrService.decodeNsec(nsec);
          await nostrService.signAndPublishEvent(event, secretKey, targetRelays);
          return { success: true };
        }

        if (signerType === 'amber') {
          // Mirror the kind-4 DM Amber path — pass the unsigned event
          // without `pubkey`; Amber sets it from `current_user`.
          const { event: signedEventJson } = await amberService.requestEventSignature(
            JSON.stringify(event),
            '',
            pubkey,
          );
          if (!signedEventJson) {
            return { success: false, error: 'Amber returned empty event' };
          }
          const signed = JSON.parse(signedEventJson);
          await nostrService.publishSignedEvent(signed, targetRelays);
          return { success: true };
        }

        if (signerType === 'nip46') {
          // Single signEvent — one bunker round-trip, no fan-out.
          const { event: signedEventJson } = await nostrConnectService.requestEventSignature(
            JSON.stringify(event),
            '',
            pubkey,
          );
          if (!signedEventJson) {
            return { success: false, error: 'NIP-46 signer returned empty event' };
          }
          const signed = JSON.parse(signedEventJson);
          await nostrService.publishSignedEvent(signed, targetRelays);
          return { success: true };
        }

        return { success: false, error: 'Unsupported signer type' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to publish group state';
        return { success: false, error: message };
      }
    },
    [pubkey, isLoggedIn, signerType, relays],
  );

  return { sendGroupMessage, publishGroupState };
}
