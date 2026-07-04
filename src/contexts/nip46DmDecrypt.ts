import * as nostrConnectService from '../services/nostrConnectService';
import type { RawGiftWrapEvent } from '../services/nostrService';
import { unwrapWrapViaNip44, type DecodedRumor } from '../utils/nip17Unwrap';

// NIP-46 ("Nostr Connect" / bunker) DM decrypt primitives. Kept out of the
// signer hooks (useDmInbox / nostrFetchConversation / nostrLiveDmSub) so those
// over-/near-cap files stay lean (CLAUDE.md → File size and modularity). Every
// call is a relay round-trip to the bunker (~200-1500ms). Unlike Amber there is
// no silent-batch fast path — `requestNip44DecryptSilent` throws — so each fresh
// wrap pays the round-trip; the ingest engine's cache hits short-circuit for
// free. There is also no PERMISSION_NOT_GRANTED concept, so callers never set a
// permission flag on the NIP-46 path.

/** NIP-04 decrypt via the bunker. Returns plaintext or throws. */
export function nip46DecryptNip04(
  ciphertext: string,
  counterpartyPubkey: string,
  ownerPubkey: string,
): Promise<string> {
  return nostrConnectService.requestNip04Decrypt(ciphertext, counterpartyPubkey, ownerPubkey);
}

/** Build the `unwrap` callback that the NIP-17 ingest / thread loops expect —
 *  routes the gift-wrap's NIP-44 decrypt through the bunker for `ownerPubkey`. */
export function nip46Unwrap(
  ownerPubkey: string,
  onSkip?: (reason: string, wrapId: string) => void,
): (wrap: RawGiftWrapEvent) => Promise<DecodedRumor | null> {
  return (wrap) =>
    unwrapWrapViaNip44(
      wrap,
      (ct, cp) => nostrConnectService.requestNip44Decrypt(ct, cp, ownerPubkey),
      onSkip,
    );
}

/** Sign an event template through the bunker, returning the fully-signed event
 *  JSON (or '' if the bunker returned nothing). Shared by the inline signer
 *  branches in NostrContext (zap / contact-list / profile / signEvent). */
export async function nip46Sign(
  event: { kind: number; created_at: number; tags: string[][]; content: string },
  ownerPubkey: string,
): Promise<string> {
  const { event: signedEventJson } = await nostrConnectService.requestEventSignature(
    JSON.stringify(event),
    '',
    ownerPubkey,
  );
  return signedEventJson;
}
