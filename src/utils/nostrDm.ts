import * as nip19 from 'nostr-tools/nip19';

type DmSendResult = { success: boolean; error?: string };
type SendDirectMessage = (recipientPubkey: string, message: string) => Promise<DmSendResult>;

// Throws synchronously on malformed npub — callers pass compile-time
// constants, so a bad value is a programmer error, not a runtime condition.
export function createDmSender(npub: string, sendDirectMessage: SendDirectMessage) {
  const decoded = nip19.decode(npub);
  if (decoded.type !== 'npub') {
    throw new Error(`createDmSender: expected npub, got ${decoded.type}`);
  }
  const hex = decoded.data;
  return (message: string): Promise<DmSendResult> => sendDirectMessage(hex, message);
}
