import * as nip19 from 'nostr-tools/nip19';

type DmSendResult = { success: boolean; error?: string };
type SendDirectMessage = (recipientPubkey: string, message: string) => Promise<DmSendResult>;

/**
 * Build an onSend callback that decodes an npub once and delegates to
 * `sendDirectMessage`. Shape matches `FeedbackSheet`'s `onSend` prop so it
 * can be dropped in directly.
 */
export function createDmSender(npub: string, sendDirectMessage: SendDirectMessage) {
  return async (message: string): Promise<DmSendResult> => {
    let hex: string;
    try {
      const decoded = nip19.decode(npub);
      if (decoded.type !== 'npub') {
        return { success: false, error: 'Recipient is not a valid npub' };
      }
      hex = decoded.data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to decode recipient npub',
      };
    }
    return sendDirectMessage(hex, message);
  };
}
